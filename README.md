### Usage

package.json already contains example commands with default options to run this job. Following flags are passed in order to control behaviour of script:

`--environment=development | staging | production`

Defines which secret manager to use according to the environment value passed.

`--cognitoReadLimit=<number>`

Defines the cognito read operations limit for listing users. Defaults to maximum of 60 per iteration. If reading from csv, this defines the batch size of the users to be processed.

`--paginationToken= PAGINATION TOKEN TO START`

Indicate cognito the pagination position to start. Defaults to null.

`--enableCsvReport=<true | false>`

Enables csv `cognito_groups_sync_report.csv` report generation through fileStreamWritter piping. Defaults to false.

`--cognitoGroupsOperationsPerSec=20`

Controls how many Cognito groups operations should be done per second. Defaults to 20

`--csv=<path-to-file>`

uses csv as input instead of whole cognito pool. Example format for csv

```
ID,Username,email,cognito_sub,groups
17,0001a99f-caaf-40af-a299-29282c19f86a,31pedvel@m.kckps.org,9e54bd07-d741-4093-b129-d93f02d7772b,[]
49,0006b89e-7656-4a89-aa05-9dd0d29ca2f7,fernando.2644839@nv.ccsd.net,2981b128-c6d9-40d2-975d-80f73d74a8f3,[]
```

note: only username is used from csv. Roles are fetched from database.

Example :

`--environment=production --cognitoReadLimit=60 --enableCsvReport=true `

`--environment=development --cognitoReadLimit=60 --enableCsvReport=true --cognitoGroupsOperationsPerSec=20`

`--environment=development --cognitoReadLimit=1 --enableCsvReport=true --cognitoGroupsOperationsPerSec=20 --maxReadCognitoLoops=2 --paginationToken=<token>`

`--csv=input.csv --environment=production --cognitoReadLimit=100 --cognitoGroupsOperationPerSec=20 --enableCsvReport=true`

---
