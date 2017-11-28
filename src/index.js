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
  constructor (serverless, options) {
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
  afterPackageInitialize () {
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
  afterCreateDeploymentArtifacts () {
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
  afterDeployFunctions () {
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
  configPlugin () {
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
      prewarm: false
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
  }

  /**
   * @description After create deployment artifacts
   *
   * @param {string} file — File path
   *
   * @return {String} Absolute file path
   * */
  getPath (file) {
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
  cleanFolder () {
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
  createHealthCheck () {
    /** Get functions */
    const allFunctions = this.serverless.service.getAllFunctions()

    /** Filter functions for health check */
    return BbPromise.filter(allFunctions, (functionName) => {
      const functionObject = this.serverless.service.getFunction(functionName)

      /** Function needs to be warm */
      if (functionObject.healthcheck === true ||
        functionObject.healthcheck === this.options.stage ||
        (Array.isArray(functionObject.healthcheck) &&
          functionObject.healthcheck.indexOf(this.options.stage) !== -1)) {
        return functionObject
      }
    }).then((functionNames) => {
      /** Skip writing if no functions need to be checked */
      if (!functionNames.length) {
        /** Log no healthcheck */
        this.serverless.cli.log('HealthCheck: no lambda to check')
        return true
      }

      /** Write health check function */
      return this.createHealthCheckFunctionArtifact(functionNames)
    }).then((skip) => {
      /** Add healt check function to service */
      if (skip !== true) {
        return this.addHealthCheckFunctionToService()
      }
    })
  }

  /**
   * @description Write health check ES6 function
   *
   * @param {Array} functionNames - Function names
   *
   * @fulfil {} — Health check function created
   * @reject {Error} Health check error
   *
   * @return {Promise}
   * */
  createHealthCheckFunctionArtifact (functionNames) {
    /** Log healthcheck start */
    this.serverless.cli.log('HealthCheck: setting ' + functionNames.length + ' lambdas to be checked')

    /** Get function names */
    functionNames = functionNames.map((functionName) => {
      const functionObject = this.serverless.service.getFunction(functionName)
      this.serverless.cli.log('HealthCheck: ' + functionObject.name)
      return functionObject.name
    })

    /** Write function invoke promises and push to array */
    const healthCheckFunction = `"use strict";

/** Generated by Serverless HealthCheck Plugin at ${new Date().toISOString()} */
const aws = require("aws-sdk");
aws.config.region = "${this.serverless.service.provider.region}";
const lambda = new aws.Lambda();
const functionNames = "${functionNames.join()}".split(",");
module.exports.healthCheck = (event, context, callback) => {
  let invokes = [];
  let errors = 0;
  console.log("Health Check Start");
  functionNames.forEach((functionName) => {
    const params = {
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      LogType: "None",
      Qualifier: process.env.SERVERLESS_ALIAS || "$LATEST",
      Payload: JSON.stringify({ source: "serverless-plugin-healthcheck" })
    };
    invokes.push(lambda.invoke(params).promise().then((data) => {
      console.log("Health Check Invoke Success: " + functionName, data);
    }, (error) => {
      errors++;
      console.log("Health Check Invoke Error: " + functionName, error);
    }));
  });
  Promise.all(invokes).then(() => {
    console.log("Health Check Finished with " + errors + " invoke errors");
    callback();
  });
}`

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
    this.serverless.service.functions.healthCheckPlugin = {
      description: 'Serverless HealthCheck Plugin',
      events: this.healthcheck.schedule.map(schedule => { return { schedule } }),
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
      .then(data => this.serverless.cli.log('HealthCheck: Functions sucessfuly pre-checked'))
      .catch(error => this.serverless.cli.log('HealthCheck: Error while pre-checking functions', error))
  }
}

/** Export HealthCheck class */
module.exports = HealthCheck
