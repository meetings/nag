#!/usr/bin/env nodejs

var fs       = require('fs')
var util     = require('util')
var http     = require('http')
var async    = require('async')
var email    = require('emailjs')
var twilio   = require('twilio')
var urlparse = require('url').parse

var CONF = {}
var CONFIG_FILE = '/etc/nag.conf'

/* * * FLOW CONTROL * * * * * * * * * * */

function init() {
    util.log("Initializing nag service")

    readConfig()
    setTimeout(mainFlowControl, 1000)
}

function mainFlowControl() {
    /*
    var postProcess = function portProcess(err, results) {
        var stats = examineResults(results)
        cb(stats.ok, stats)
    }
    */

    var roundOne = function roundOne(callback) {
        var postProcess = function postProcess(err, results) {
            /// debug("RESULTS ARE HERE", results)
            var stats = examineResults(results)
            callback(stats.ok, stats)
        }

        checkAllServices(postProcess)
    }

    var roundTwo = function roundTwo(stats, callback) {
        var postProcess = function postProcess(err, results) {
            var stats = examineResults(results)
            callback(stats.ok, stats)
        }

        logFailedToStdout(stats.log_messages)
        checkAllServices(postProcess)
    }

    var roundThree = function roundThree(stats, callback) {
        var postProcess = function postProcess(err, results) {
            var stats = examineResults(results)
            callback(stats.ok, stats)
        }

        logFailedToStdout(stats.log_messages)
        spamPeopleWithEmail(stats)
        checkAllServices(postProcess)
    }

    var roundFour = function roundFour(stats, callback) {
        logFailedToStdout(stats.log_messages)
        makePhonesBeep(stats.text_message)
        callback(null)
    }

    util.log("Checking services")

    async.waterfall([roundOne, roundTwo, roundThree, roundFour], loop)
}

function loop() {
    setTimeout(mainFlowControl, CONF.poll_interval)
}

function hup() {
    util.log("Caught sighup, reading configuration")

    readConfig()
}

function exit() {
    util.log("Caught sigint, exiting")

    process.exit(0)
}

/* * * SERVICE CHECKING * * * * * * * * */

function checkAllServices(postProcess) {
    var joblist = []

    CONF.target_services.forEach(function(service) {
        joblist.push(function(callback) {
            httpRequest(service, callback)
        })
    })

    async.parallelLimit(joblist, CONF.parallel_limit, postProcess)
}

function examineResults(results) {
    var stats = {
        'ok': true,
        'log_messages': [],
        'email_message': 'Unable to connect to the following services:\n\n',
        'text_message': 'ALERT:'
    }

    async.filter(results, selectFailed, function(failedServices) {
        failedServices.forEach(function(service) {
            /* Should be null on error, because
             * only then async.waterfall flows down.
             */
            stats.ok = null

            stats.log_messages.push(util.format(
                'Service %s failed: %s (%s ms)', service.name,
                CONF.http_codes[service.code], service.time
            ))

            stats.email_message += util.format(
                '%s: %s (%s %s)\n',
                service.name, service.url,
                service.code, CONF.http_codes[service.code]
            )

            stats.text_message += ' ' + service.name
        })
    })

    return stats
}

function selectFailed(obj, callback) {
    callback(typeof obj.code !== 'undefined' && obj.code != 200)
}

/* * * ADMINISTRATOR NOTIFICATION * * * */

function logFailedToStdout(messages) {
    messages.forEach(util.log)
}

function spamPeopleWithEmail(stats) {
    var mail = {
        text:    stats.email_message,
        from:    CONF.mail_sender,
        to:      CONF.mail_recipients,
        subject: stats.text_message
    }

    var errHandler = function errHandler(err) {
        if (err) util.log("Unable to send email, please check mail server options")
    }

    var connection = email.server.connect(CONF.mail_server_opts)

    connection.send(mail, errHandler)

    util.log("Mail sent to: " + mail.to)
}

function makePhonesBeep(message) {
    if (!CONF.sms_recipients instanceof Array) {
        util.log("Unable to send sms, please check configuration")
    }

    // var twilioclient = new twilio.RestClient(CONF.twilio_account_sid, CONF.twilio_auth_token)

    CONF.sms_recipients.forEach(function(number) {
        var sms = {
            to:   number,
            from: CONF.twilio_from_nro,
            body: message
        }

        var callback = function(err, msg) {
            if (err) util.log("Sending text message failed")
            else { /// FIXME debug
                debug("TWILIO ONNISTUI", msg)
            }
        }

        // twilioclient.sms.messages.create(sms, callback)

        util.log("SMS sent to: " + sms.to)
    })
}

/* * * SENDING HTTP REQUESTS  * * * * * */

var httpRequest = function httpRequest(service, callback) {
    var url = urlparse(service.url)

    var opt = {
        host:    url.hostname,
        port:    url.port,
        method:  'GET',
        path:    url.pathname,
        headers: { 'Connection': 'close' }
    }

    var atStart = new Date().getTime()

    var request = http.request(opt, function(response) {
        util.log("Got responce from " + service.name)
        callback(null, {
            name: service.name,
            code: response.statusCode,
            head: response.headers,
            time: (new Date().getTime() - atStart),
            url:  url.href
        })
    })

    request.on('error', function() {
        util.log("Unreachable service: " + url.href)
        callback(null, {
            code: 600,
            name: service.name,
            time: 0,
            url:  url.href
        })
    })

    request.end()
}

/* * * CONFIGURATION HANDLING * * * * * */

function readConfig() {
    var file = fs.readFileSync(CONFIG_FILE, {encoding: 'utf8'})

    try {
        CONF = JSON.parse(file)
        util.log("Configuration read successfully")
    }
    catch (err) {
        util.log("Failed to parse configuration!")
        util.log("--")
        util.log("Configuration must be valid json data and")
        util.log("config file is expected to be found at")
        util.log(CONFIG_FILE + ".")
        util.log("--")
        process.exit(1)
    }

    //// FIXME: Validate configuration somehow.
}

/* * * DEBUG  * * * * * * * * * * * * * */

function debug(msg, obj) {
    console.log("DEBUG :: " + msg + " ::")
    console.log(util.inspect(obj, {showHidden: true, depth: 2, colors: true}))
}

process.on('uncaughtException', function(err) {
    debug("UNCAUGHTEXCEPTION", err)
    process.exit(1)
})

process.on('SIGINT', exit)
process.on('SIGHUP', hup)

init()
