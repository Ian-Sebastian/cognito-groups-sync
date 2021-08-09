import minimist, { ParsedArgs } from 'minimist';
import { AWSError, CognitoIdentityServiceProvider, SecretsManager } from 'aws-sdk';
import { Connection, createConnection } from 'typeorm';
import { PromiseResult } from 'aws-sdk/lib/request';
// import * as CsvWriter from 'csv-write-stream';
import fs, { WriteStream } from 'fs';

const CsvWriter = require('csv-write-stream');

const COGNITO_READ_LIMIT_DEFAULT = 60;
const COGNITO_GROUP_OPERATIONS_PER_SEC_DEFAULT = 20;
const ENABLE_CSV_REPORT_DEFAULT = false;

// Non I/O  blocking pause
async function sleep(millisecond: number): Promise<void> {
  return await new Promise((r, _) => {
    setTimeout(() => {
      return r();
    }, millisecond);
  });
}

class ConfigurationService {
  private secretManager: SecretsManager;
  private secretManagerId: string;
  private secrets: object;
  public cognitoReadLimit: number;
  public enableCsvReport: boolean;

  constructor(secretManagerId: string, cognitoReadLimit: number, enableCsvReport: boolean) {
    this.secretManager = new SecretsManager({ region: 'us-east-1' });
    this.secretManagerId = secretManagerId;
    this.cognitoReadLimit = cognitoReadLimit;
    this.enableCsvReport = enableCsvReport;
  }

  public static async factory(
    secretManagerId: string,
    cognitoReadLimit: number,
    enableCsvReport: boolean,
  ) {
    const newConfigurationService = new ConfigurationService(
      secretManagerId,
      cognitoReadLimit,
      enableCsvReport,
    );
    await newConfigurationService.setSecrets();
    return newConfigurationService;
  }

  private async setSecrets() {
    const { SecretString } = await this.secretManager
      .getSecretValue({ SecretId: this.secretManagerId })
      .promise();
    this.secrets = JSON.parse(SecretString);
  }

  // public interface below this line

  public get(key: string) {
    // @ts-ignore
    return this.secrets[key];
  }
}

class DatabaseService {
  private databaseConfiguration: {
    host: string;
    database: string;
    username: string;
    password: string;
  };
  private database: Connection;

  constructor(configurationService: ConfigurationService) {
    this.databaseConfiguration = {
      host: configurationService.get('DB__ROSTER__HOST'),
      database: configurationService.get('DB__ROSTER__DATABASE'),
      username: configurationService.get('DB__ROSTER__USERNAME'),
      password: configurationService.get('DB__ROSTER__PASSWORD'),
    };
  }

  public static async factory(configurationService: ConfigurationService) {
    const newDatabaseService = new DatabaseService(configurationService);
    await newDatabaseService.createDriverConnection();
    return newDatabaseService;
  }

  private async createDriverConnection() {
    this.database = await createConnection({
      type: 'postgres',
      host: this.databaseConfiguration.host,
      database: this.databaseConfiguration.database,
      username: this.databaseConfiguration.username,
      password: this.databaseConfiguration.password,
      logging: false,
    });
  }

  // public interface below this line

  public async getUser(id: string) {
    try {
      const result = await this.database.query(`SELECT * FROM "user" u where u.id = '${id}'`);
      return result;
    } catch (error) {
      console.error('Query for user failed ->', id);
      return null;
    }
  }

  public async getUserRoles(id: string) {
    try {
      const student = await this.database
        .createQueryBuilder()
        .select('*')
        .from('student', 's')
        .where('s.user_id = :id', { id })
        .andWhere('s.deleted_at IS NULL')
        .getRawOne();

      const teacher = await this.database
        .createQueryBuilder()
        .select('*')
        .from('teacher', 't')
        .where('t.user_id = :id', { id })
        .andWhere('t.deleted_at IS NULL')
        .getRawOne();

      const schoolAdmin = await this.database
        .createQueryBuilder()
        .select('*')
        .from('school_admin', 'sa')
        .where('sa.user_id = :id', { id })
        .andWhere('sa.deleted_at IS NULL')
        .getRawOne();

      const districtAdmin = await this.database
        .createQueryBuilder()
        .select('*')
        .from('district_admin', 'da')
        .where('da.user_id = :id', { id })
        .andWhere('da.deleted_at IS NULL')
        .getRawOne();

      return Object.entries({
        student,
        teacher,
        ['school-admin']: schoolAdmin,
        ['district-admin']: districtAdmin,
      })
        .filter((role: { 0: string; 1: Object }) => role[1] !== undefined)
        .map((role: { 0: string; 1: Object }) => role[0]);
    } catch (error) {
      console.error(error);
      console.error('Query for user failed ->', id);
      return [];
    }
  }
}

class CognitoService {
  private cognitoApi: CognitoIdentityServiceProvider;
  private reportingApi: ReportingService;
  private userPoolId: string;
  private userReadLimit: number;

  constructor(configurationService: ConfigurationService, reportingService: ReportingService) {
    this.cognitoApi = new CognitoIdentityServiceProvider({
      region: 'us-east-1',
    });
    this.reportingApi = reportingService;
    this.userPoolId = configurationService.get('AWS_NEW_USER_POOL_ID');
    this.userReadLimit = configurationService.cognitoReadLimit || COGNITO_READ_LIMIT_DEFAULT;
  }

  public async listUsers(paginationToken?: string) {
    const AttributesToGet: [] = [];
    const params = {
      AttributesToGet,
      Filter: '',
      Limit: this.userReadLimit,
      PaginationToken: paginationToken || null,
      UserPoolId: this.userPoolId,
    };
    return this.cognitoApi.listUsers(params).promise();
  }

  public async addUserToGroups(username: string, roles: string[]) {
    if (roles.length === 0) {
      console.warn(`User ${username} has no roles associated on database`);
      this.reportingApi.appendRecord(username, roles, 'No roles found on database');
      return;
    }

    console.info(`Time: ${Date.now()} - Patching ${username} with ${roles}`);

    return Promise.all(
      roles.map(async (role) => {
        try {
          await this.cognitoApi
            .adminAddUserToGroup({
              GroupName: role,
              UserPoolId: this.userPoolId,
              Username: username,
            })
            .promise();
          return this.reportingApi.appendRecord(username, roles, null);
        } catch (err) {
          console.error('Oops! something happened', err);
          return this.reportingApi.appendRecord(username, roles, err);
        }
      }),
    );
  }
}

class ReportingService {
  public static instance: ReportingService;
  private enableReport: boolean;
  private writeStream: WriteStream;
  private writer: any;
  constructor(configurationService: ConfigurationService) {
    this.enableReport = configurationService.enableCsvReport;
    if (!configurationService.enableCsvReport) return;
    // this.writeStream = fs.createWriteStream(`report_${new Date().toISOString()}.csv`, {
    //   flags: 'a',
    // });
    this.writeStream = fs.createWriteStream(`cognito_groups_sync_report.csv`);
    this.writer = CsvWriter({ headers: ['username', 'roles', 'error'] });
    this.writer.pipe(this.writeStream);
    ReportingService.instance = this;
  }

  public appendRecord(username: string, roles: string[], error: any): void {
    if (!this.enableReport) return null;
    this.writer.write([username, roles, error]);
  }

  public static closeReport() {
    if (!ReportingService.instance) {
      return console.warn("Warning: trying to close a reporting service which doesn't exists");
    }
    ReportingService.instance.writer.end();
    ReportingService.instance.writeStream.close();
    delete ReportingService.instance;
  }
}

interface inputParams extends ParsedArgs {
  environment: string;
  cognitoReadLimit: number;
  enableCsvReport: string;
  paginationToken: string;
  cognitoGroupsOperationsPerSec: number;
}

async function cliWrapper() {
  try {
    const args: inputParams = minimist(process.argv.slice(2)) as inputParams;
    if (!args.environment) {
      console.info(
        'Please pass environment to fix this crab as --environment=development | staging | production',
      );
      throw new Error('environment argument cannot be null');
    }

    let secretManagerId: string;
    switch (args.environment) {
      case 'production':
        secretManagerId = 'prod-dp-account-management-secrets';
        break;
      case 'staging':
        secretManagerId = 'stage-dp-account-management-secrets';
        break;
      case 'development':
        secretManagerId = 'dev-dp-account-management-secrets';
        break;
      default:
        throw new Error('Invalid environment values passed');
    }

    let cognitoReadLimit: number;
    if (!args.cognitoReadLimit || args.cognitoReadLimit > 60) {
      console.info(
        `--cognitoReadLimit flag not present or invalid, defaulting to max ${COGNITO_READ_LIMIT_DEFAULT}`,
      );
      cognitoReadLimit = COGNITO_READ_LIMIT_DEFAULT;
    } else {
      cognitoReadLimit = args.cognitoReadLimit;
    }

    let enableCsvReport: boolean;
    if (!args.enableCsvReport) {
      console.info(
        `--enableCsvReport flag not present, defaulting to ${ENABLE_CSV_REPORT_DEFAULT}`,
      );
      enableCsvReport = ENABLE_CSV_REPORT_DEFAULT;
    } else {
      enableCsvReport = args.enableCsvReport === 'true' ? true : false;
    }

    let paginationToken: string;
    if (!args.paginationToken) {
      console.info(`--paginationToken, defaulting to null`);
      paginationToken = null;
    } else {
      paginationToken = args.paginationToken;
    }

    let cognitoGroupsOperationsPerSec: number;
    if (!args.cognitoGroupsOperationsPerSec) {
      console.info(`--cognitoGroupsOperationsPerSec, defaulting to 20`);
      cognitoGroupsOperationsPerSec = COGNITO_GROUP_OPERATIONS_PER_SEC_DEFAULT;
    } else {
      cognitoGroupsOperationsPerSec = args.cognitoGroupsOperationsPerSec;
    }

    await main(
      secretManagerId,
      cognitoReadLimit,
      enableCsvReport,
      paginationToken,
      cognitoGroupsOperationsPerSec,
    );
  } catch (error) {
    console.error('Oops! something went wrong', error);
  } finally {
    ReportingService.closeReport();
  }
}

async function main(
  secretManagerId: string,
  cognitoReadLimit: number,
  enableCsvReport: boolean,
  paginationTokenContinue: string,
  cognitoGroupsOperationsPerSec: number,
) {
  console.time('timeTook');
  const configurationService = await ConfigurationService.factory(
    secretManagerId,
    cognitoReadLimit,
    enableCsvReport,
  );
  const databaseService = await DatabaseService.factory(configurationService);
  const reportingService = new ReportingService(configurationService);
  const cognitoService = new CognitoService(configurationService, reportingService);

  let paginationToken: string = paginationTokenContinue;
  let cognitoResponse: PromiseResult<CognitoIdentityServiceProvider.ListUsersResponse, AWSError>;
  let counter = 0;
  do {
    const readUsersTresholder = sleep(1000); // creates async timer that we'd await later

    cognitoResponse = await cognitoService.listUsers(paginationToken);
    console.info(`===>> paginationToken iterations: ${paginationToken}`);
    paginationToken = cognitoResponse.PaginationToken;
    //console.log(cognitoResponse.Users);

    /**
     * - map each user operation to a promise
     * - chain each promise with reduce
     * - await reduced return before next batch
     */
    await cognitoResponse.Users.map(async (user) => {
      const roles = await databaseService.getUserRoles(user.Username);
      console.log(roles);
      return { username: user.Username, roles };
    }).reduce(async (previousPromise, currentUserPromise) => {
      await previousPromise;
      const { username, roles } = await currentUserPromise;
      await cognitoService.addUserToGroups(username, roles);
      return await sleep(1000 / cognitoGroupsOperationsPerSec);
    }, Promise.resolve());

    await readUsersTresholder; // await in case all operations are processed before 1 second passes
  } while (cognitoResponse.$response.hasNextPage());
  console.timeEnd('timeTook');
  console.log('Users processed: ', counter);
  return;
}

cliWrapper();
