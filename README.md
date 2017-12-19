# Serverless HealthCheck Plugin

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm (scoped)](https://img.shields.io/npm/v/@financial-times/serverless-plugin-healthcheck.svg)](https://www.npmjs.com/package/@financial-times/serverless-plugin-healthcheck)
[![npm](https://img.shields.io/npm/dw/@financial-times/serverless-plugin-healthcheck)](https://www.npmjs.com/package/@financial-times/serverless-plugin-healthcheck)
[![license](https://img.shields.io/npm/l/serverless-plugin-healthcheck.svg)](https://raw.githubusercontent.com/Financial-Times/serverless-plugin-healthcheck/master/LICENSE)

Check the health of your lambdas.

**Requirements:**

* Serverless _v1.12.x_ or higher.
* AWS provider

## How it works

Healthcheck solves _heart beat_ by creating one schedule event lambda that invokes all the service lambdas you select in a configured time interval (default: 5 minutes) or a specific time, forcing your containers to report their status.
In aditional, it creates a new endpoint (named \_\_health by default) which can be called to provide a json summary of the current status of each healthcheck.

## Setup

Install via npm in the root of your Serverless service:

```
npm install serverless-plugin-healthcheck --save-dev
```

* Add the plugin to the `plugins` array in your Serverless `serverless.yml`:

```yml
plugins:
  - serverless-plugin-healthcheck
```

* Add a `healthcheck` property to all the events in all the functions you want to be checked.

```yml
functions:
  hello:
    events
      - http:
          path: /schema/{TypeID}
          method: get
          private: false
          healthcheck:
            params: {"subjectType": "system"}
      - http:
          path: /schema/{TypeID}/{ItemID}
          method: get
          private: false
          healthcheck:
            params: {"subjectType": "system", "subjectID": "dewey"}
```

* Add additional format properties to trigger the output of a full diagnotic for each check

```yml
         healthcheck:
            params: {"subjectType": "system"}
            format:
              id: fullschema
              name: Get system schema
              ok: []
              severity: 2
              businessImpact: Unable to describe system records
              technicalSummary: The schema for the system type cannot be read from the CMDB
              checkOutput: false
              lastUpdated: []
```

Note that the ok and lastUpdated are reserved and will automatically be populated, as follows:
o ok is true when statuscode is 200, false otherwise
o lastUpdated is the date.time at which the check was ran

* healthcheck to be able to `invoke` lambdas requires the following Policy Statement in `iamRoleStatements`:

```yaml
iamRoleStatements:
  - Effect: 'Allow'
    Action:
      - 'lambda:InvokeFunction'
    Resource:
    - Fn::Join:
      - ':'
      - - arn:aws:lambda
        - Ref: AWS::Region
        - Ref: AWS::AccountId
        - function:${self:service}-${opt:stage, self:provider.stage}-*
```

If using pre-check, the deployment user also needs a similar policy so it can run the healthcheck lambda.

* All done! healthcheck will run on SLS `deploy` and `package` commands

## Options

* **cleanFolder** (default `true`)
* **memorySize** (default `128`)
* **name** (default `${service}-${stage}-healthcheck-plugin`)
* **schedule** (default `rate(5 minutes)`)
* **timeout** (default `10` seconds)
* **precheck** (default `false`)
* **endpoint** (default `__health`)

```yml
custom:
  healthcheck:
    cleanFolder: false,
    memorySize: 256
    name: 'make-them-pop'
    schedule: 'rate(15 minutes)'
    timeout: 20
    precheck: true
    endpoint: _show_health
```

* define a custom header for the healtcheck to give the healtcheck output some contaxt

```yml
    endpoint: __health
    format:
      schemaVersion: 1
      name: A great system that uses healthchecks
      systemCode: greatsys
      checks: []
```

Note that checks is reserved and is used to identify the location into which the array of check responses will be placed

**Lambdas invoked by healthcheck will have event source `serverless-plugin-healthcheck`:**

```json
{
    "Event": {
        "source": "serverless-plugin-healthcheck"
    }
}
```

## Artifact

If you are doing your own [package artifact](https://serverless.com/framework/docs/providers/aws/guide/packaging#artifact) set option `cleanFolder` to `false` and run `serverless package`. This will allow you to extract the `healthcheck` NodeJS lambda file from the `_healthcheck` folder and add it in your custom artifact logic.

## Gotchas

If you are deploying to a VPC, you need to use private subnets with a Network Address Translation (NAT) gateway (http://docs.aws.amazon.com/lambda/latest/dg/vpc.html). Healthcheck requires this so it can call the other lambdas but this is applicable to any lambda that needs access to the public internet or to any other AWS service.

Only one lambda function will be checked/invoked per HealthCheck declaration, even if multiple containers are running.

## Cost

Lambda pricing [here](https://aws.amazon.com/lambda/pricing/). CloudWatch pricing [here](https://aws.amazon.com/cloudwatch/pricing/). You can use [AWS Lambda Pricing Calculator](https://s3.amazonaws.com/lambda-tools/pricing-calculator.html) to check how much will cost you monthly.

### Example

Free Tier not included + Default HealthCheck options + 10 lambdas to check, each with `memorySize = 1024` and `duration = 10`:

* HealthCheck: runs 8640 times per month = $0.18
* 10 checked lambdas: each invoked 8640 times per month = $14.4
* Total = $14.58

CloudWatch costs are not in this example because they are very low.

## Contribute

Help us making this plugin better and future proof.

* Clone the code
* Install the dependencies with `npm install`
* Create a feature branch `git checkout -b new_feature`
* Lint with standard `npm run lint`

## License

This software is released under the MIT license. See [the license file](LICENSE) for more details.
