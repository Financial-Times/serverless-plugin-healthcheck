Serverless HealthCheck  Plugin
==============================
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-plugin-healthcheck.svg)](https://badge.fury.io/js/serverless-plugin-healthcheck)
[![npm downloads](https://img.shields.io/npm/dm/serverless-plugin-healthcheck.svg)](https://www.npmjs.com/package/serverless-plugin-healthcheck)
[![license](https://img.shields.io/npm/l/serverless-plugin-healthcheck.svg)](https://raw.githubusercontent.com/FidelLimited/serverless-plugin-healthcheck/master/LICENSE)

Check the health of your lambdas.

**Requirements:**
* Serverless *v1.12.x* or higher.
* AWS provider

## How it works

Healthcheck solves *heart beat* by creating one schedule event lambda that invokes all the service lambdas you select in a configured time interval (default: 5 minutes) or a specific time, forcing your containers to report their status.

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

* Add a `healthcheck` property to all functions you want to be warm.

You can enable healthcheck in general:

```yml
functions:
  hello:
    healthcheck: true
```

For a specific stage:

```yml
functions:
  hello:
    healthcheck: production
```

For several stages:

```yml
functions:
  hello:
    healthcheck:
      - production
      - staging
```
* helthcheck to be able to `invoke` lambdas requires the following Policy Statement in `iamRoleStatements`:

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
* **schedule** (default `rate(5 minutes)`) - More examples [here](https://docs.aws.amazon.com/lambda/latest/dg/tutorial-scheduled-events-schedule-expressions.html).
* **timeout** (default `10` seconds)
* **prewarm** (default `false`)
* **folderName** (default `_warmup`)

```yml
custom:
  warmup:
    cleanFolder: false,
    memorySize: 256
    name: 'make-them-pop'
    schedule: 'cron(0/5 8-17 ? * MON-FRI *)' // Run WarmUP every 5 minutes Mon-Fri between 8:00am and 5:55pm (UTC)
    timeout: 20
    precheck: true // Run healthcheck immediately after a deployment
    folderName: '_healthcheck' // Name of the folder created for the generated healthcheck lambda
```

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

If you are deploying to a VPC, you need to use private subnets with a Network Address Translation (NAT) gateway (http://docs.aws.amazon.com/lambda/latest/dg/vpc.html). WarmUp requires this so it can call the other lambdas but this is applicable to any lambda that needs access to the public internet or to any other AWS service.

## Cost

Lambda pricing [here](https://aws.amazon.com/lambda/pricing/). CloudWatch pricing [here](https://aws.amazon.com/cloudwatch/pricing/). You can use [AWS Lambda Pricing Calculator](https://s3.amazonaws.com/lambda-tools/pricing-calculator.html) to check how much will cost you monthly.

#### Example

Free Tier not included + Default WarmUP options + 10 lambdas to warm, each with `memorySize = 1024` and `duration = 10`:
* WarmUP: runs 8640 times per month = $0.18
* 10 warm lambdas: each invoked 8640 times per month = $14.4
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
