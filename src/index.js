'use strict'

/**
 * @module serverless-plugin-healthcheck
 *
 * @see {@link https://serverless.com/framework/docs/providers/aws/guide/plugins/}
 *
 * @requires 'bluebird'
 * @requires 'fs-extra'
 * @requires 'path'
 * */
const BbPromise = require('bluebird')
const fs = BbPromise.promisifyAll(require('fs-extra'))
const path = require('path')
const tokenSubstitute = require('token-substitute')

/**
 * @classdesc Check the health of your lambdas
 * @class HealthCheck
 * */
class HealthCheck {
  /**
   * @description Serverless Health Check
   * @constructor
   *
   * @param {!Object} serverless - Serverless object
   * @param {!Object} options - Serverless options
   * */
  constructor(serverless, options) {
    /** Serverless variables */
    this.serverless = serverless
    this.options = options
    this.custom = this.serverless.service.custom
    this.provider = this.serverless.getProvider('aws')

    this.hooks = {
      'after:package:initialize': this.afterPackageInitialize.bind(this),
      'after:package:createDeploymentArtifacts': this.afterCreateDeploymentArtifacts.bind(this),
      'after:deploy:deploy': this.afterDeployFunctions.bind(this)
    }
  }

  /**
   * @description After package initialize hook. Create healthcheck function and add it to the service.
   *
   * @fulfil {} — Health Check set
   * @reject {Error} Health Check error
   *
   * @return {(boolean|Promise)}
   * */
  afterPackageInitialize() {
    this.configPlugin()
    return this.createHealthCheck()
  }

  /**
   * @description After create deployment artifacts. Clean prefix folder.
   *
   * @fulfil {} — Optimization finished
   * @reject {Error} Optimization error
   *
   * @return {Promise}
   * */
  afterCreateDeploymentArtifacts() {
    return this.cleanFolder()
  }

  /**
   * @description After deploy functions hooks
   *
   * @fulfil {} — Functions health checked up sucessfuly
   * @reject {Error} Functions couldn't be health checked
   *
   * @return {Promise}
   * */
  afterDeployFunctions() {
    this.configPlugin()
    if (this.healthcheck.precheck) {
      return this.healthCheckFunctions()
    }
  }

  /**
   * @description Configure the plugin based on the context of serverless.yml
   *
   * @return {}
   * */
  configPlugin() {
    /** Set health check folder, file and handler paths */
    this.folderName = '_healthcheck'
    if (this.custom && this.custom.healthcheck && typeof this.custom.healthcheck.folderName === 'string') {
      this.folderName = this.custom.healthcheck.folderName
    }
    this.pathFolder = this.getPath(this.folderName)
    this.pathFile = this.pathFolder + '/index.js'
    this.pathHandler = this.folderName + '/index.healthCheck'

    /** Default options */
    this.healthcheck = {
      cleanFolder: true,
      memorySize: 128,
      name: this.serverless.service.service + '-' + this.options.stage + '-healthcheck-plugin',
      schedule: ['rate(5 minutes)'],
      timeout: 10,
      precheck: false,
      endpoint: '__health'
    }

    /** Set global custom options */
    if (!this.custom || !this.custom.healthcheck) {
      return
    }

    /** Clean folder */
    if (typeof this.custom.healthcheck.cleanFolder === 'boolean') {
      this.healthcheck.cleanFolder = this.custom.healthcheck.cleanFolder
    }

    /** Memory size */
    if (typeof this.custom.healthcheck.memorySize === 'number') {
      this.healthcheck.memorySize = this.custom.healthcheck.memorySize
    }

    /** Function name */
    if (typeof this.custom.healthcheck.name === 'string') {
      this.healthcheck.name = this.custom.healthcheck.name
    }

    /** Schedule expression */
    if (typeof this.custom.healthcheck.schedule === 'string') {
      this.healthcheck.schedule = [this.custom.healthcheck.schedule]
    } else if (Array.isArray(this.custom.healthcheck.schedule)) {
      this.healthcheck.schedule = this.custom.healthcheck.schedule
    }

    /** Timeout */
    if (typeof this.custom.healthcheck.timeout === 'number') {
      this.healthcheck.timeout = this.custom.healthcheck.timeout
    }

    /** Pre-check */
    if (typeof this.custom.healthcheck.precheck === 'boolean') {
      this.healthcheck.precheck = this.custom.healthcheck.precheck
    }

    /** Endpoint name */
    if (typeof this.custom.healthcheck.endpoint === 'string') {
      this.healthcheck.endpoint = this.custom.healthcheck.endpoint
    }
  }

  /**
   * @description After create deployment artifacts
   *
   * @param {string} file — File path
   *
   * @return {String} Absolute file path
   * */
  getPath(file) {
    return path.join(this.serverless.config.servicePath, file)
  }

  /**
   * @description Clean prefix folder
   *
   * @fulfil {} — Folder cleaned
   * @reject {Error} File system error
   *
   * @return {Promise}
   * */
  cleanFolder() {
    if (!this.healthcheck.cleanFolder) {
      return Promise.resolve()
    }
    return fs.removeAsync(this.pathFolder)
  }

  /**
   * @description Health check functions
   *
   * @fulfil {} — Health check function created and added to service
   * @reject {Error} Health check error
   *
   * @return {Promise}
   * */
  createHealthCheck() {
    return this.getFunctionsWithHealthChecks()
      .then((functionNames) => {
        if (!functionNames.length) {
          this.serverless.cli.log('HealthCheck: no lambda to check')
          return true
        }

        return this.createHealthCheckFunctionArtifact(functionNames)
      }).then((skip) => {
        if (skip !== true) {
          return this.addHealthCheckFunctionToService()
        }
      })
  }

  /**
   * @description Discover functions that are configured for healthchecks
   *
   * @fulfil {} — List if healthcheck function objects
   * @reject {Error} Health check error
   *
   * @return {Promise}
   * */
  getFunctionsWithHealthChecks() {
    const allFunctions = this.serverless.service.getAllFunctions().map( (functionName) => {
      const functionObject = this.serverless.service.getFunction(functionName)
      return {
        name: functionObject.name,
        stage: functionObject.healthcheck,
        checks: this.getEventsWithHealthChecks(functionName)
      }
    })

    return BbPromise.filter(allFunctions, (functionInfo) => {
      /** Function needs to be checked */
      if (functionInfo.stage === true ||
        functionInfo.stage === this.options.stage ||
        (Array.isArray(functionInfo.stage) &&
          functionInfo.stage.indexOf(this.options.stage) !== -1)) {
        return functionInfo
      }
    })
  }

  /**
   * @description Discover events within function that are configured for healthchecks
   *
   * @return (Array) of healthcheck parameters
   * */
  getEventsWithHealthChecks(functionName) {

    return this.serverless.service.getAllEventsInFunction(functionName)
      .reduce( (healthchecks, eventObject) => {
        if (eventObject.http.healthcheck) {
          healthchecks.push({
            params: eventObject.http.healthcheck.params,
            format: eventObject.http.healthcheck.format
          })
        }
        return healthchecks
      }, [] )
  }

  /**
   * @description Write health check ES6 function
   *
   * @param {Array} functionObjects - Function infomation, inlcuding event params
   *
   * @fulfil {} — Health check function created
   * @reject {Error} Health check error
   *
   * @return {Promise}
   * */

  createHealthCheckFunctionArtifact(functionObjects) {

    this.serverless.cli.log('HealthCheck: setting ' + functionObjects.length + ' lambdas to be checked')

    const functionNames = functionObjects.map((functionObject) => {
      this.serverless.cli.log('HealthCheck: ' + functionObject.name)
      const eventNames = functionObject.checks.map((eventObject) => {
        this.serverless.cli.log('    Params: ' + JSON.stringify(eventObject.params))
      })
    })

    const healthcheckTemplate = fs.readFileSync('./.serverless_plugins/plugin_template.js', 'utf8');
    const healthCheckFunction = tokenSubstitute(healthcheckTemplate,{
      tokens:{
        creationDate: new Date().toISOString(),
        awsRegion: this.serverless.service.provider.region,
        healthchecks: JSON.stringify(functionObjects),
        outputHeader: JSON.stringify(this.custom.healthcheck.format)
      }
    });

    /** Write health check file */
    return fs.outputFileAsync(this.pathFile, healthCheckFunction)
  }

  /**
   * @description Add Health check function to service
   *
   * @return {Object} Health check service function object
   * */
  addHealthCheckFunctionToService () {
    /** SLS health check function */
    this.serverless.cli.log(JSON.stringify(this.healthcheck.schedule))
    this.serverless.service.functions.healthCheckPlugin = {
      description: 'Serverless HealthCheck Plugin',
      events: [{
        "http":{
          "path": this.healthcheck.endpoint,
          "method":"get",
          "private":false
        },
        "schedule": {
          rate: this.healthcheck.schedule
        }
      }],
      handler: this.pathHandler,
      memorySize: this.healthcheck.memorySize,
      name: this.healthcheck.name,
      runtime: 'nodejs6.10',
      package: {
        individually: true,
        exclude: ['**'],
        include: [this.folderName + '/**']
      },
      timeout: this.healthcheck.timeout
    }

    /** Return service function object */
    return this.serverless.service.functions.healthCheckPlugin
  }

  /**
   * @description Health check the functions immediately after deployment
   *
   * @fulfil {} — Functions checked up sucessfuly
   * @reject {Error} Functions couldn't be health checked
   *
   * @return {Promise}
   * */
  healthCheckFunctions () {

    this.serverless.cli.log('HealthCheck: Pre-checking up your functions')

    const params = {
      FunctionName: this.healthcheck.name,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: process.env.SERVERLESS_ALIAS || '$LATEST',
      Payload: JSON.stringify({ source: 'serverless-plugin-healthcheck' })
    }

    return this.provider.request('Lambda', 'invoke', params)
      .then(data => {
        const response = JSON.parse(data.Payload)
        if ((response.statusCode && response.statusCode!==200) || response.errorMessage) {
          this.serverless.cli.log("HealthCheck: Failure: " + response.errorMessage);
        } else {
          this.serverless.cli.log('HealthCheck: Functions successfuly pre-checked')
        }
      })
      .catch(error => this.serverless.cli.log('HealthCheck: Error while pre-checking functions'+ error))
  }
}

/** Export HealthCheck class */
module.exports = HealthCheck
