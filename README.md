### Usage

package.json already contains example commands with default options to run this job. Following flags are passed in order to control behaviour of script:

`--environment=development | staging | production`

Defines which secret manager to use according to the environment value passed.

`--cognitoReadLimit=<number>`

Defines the cognito read operations limit for listing users. Defaults to maximum of 60 per iteration


`--paginationToken= PAGINATION TOKEN TO START`

Indicate cognito the pagination position to start. Defaults to null.


`--enableCsvReport=<true | false>`

Enables csv `cognito_groups_sync_report.csv` report generation through fileStreamWritter piping. Defaults to false. 


`--cognitoGroupsOperationsPerSec=20"`

Controls how many Cognito groups operations should be done per second. Defaults to 20


Example :

`--environment=production --cognitoReadLimit=60 --enableCsvReport=true `

`--environment=development --cognitoReadLimit=60 --enableCsvReport=true --cognitoGroupsOperationsPerSec=20`

---

