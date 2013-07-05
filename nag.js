#!/usr/bin/env nodejs

var fs       = require('fs')
var util     = require('util')
var http     = require('http')
var async    = require('async')
var email    = require('emailjs')
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
    /* Query all the services.
     */
    var roundOne = function roundOne(callback) {
        var postProcess = function postProcess(err, results) {
            var stats = examineResults(results, CONF.short_limit)
            /// if (stats.ok) util.log("All ok!")
            callback(stats.ok, stats)
        }

        checkAllServices(postProcess)
    }

    /* Complain to console and requery services.
     */
    var roundTwo = function roundTwo(stats, callback) {
        var postProcess = function postProcess(err, results) {
            var stats = examineResults(results, CONF.long_limit)
            callback(stats.ok, stats)
        }

        logToStdout(stats)
        checkAllServices(postProcess)
    }

    /* Send email and query services yet again.
     */
    var roundThree = function roundThree(stats, callback) {
        var postProcess = function postProcess(err, results) {
            var stats = examineResults(results, CONF.patient_limit)
            callback(stats.ok, stats)
        }

        logToStdout(stats)
        spamPeopleWithEmail(stats)
        checkAllServices(postProcess)
    }

    /* Send text message and give up.
     */
    var roundFour = function roundFour(stats, callback) {
        logToStdout(stats)
        makePhonesBeep(stats)
        callback(null)
    }

    util.log("Checking services")

    async.waterfall([roundOne, roundTwo, roundThree, roundFour], loop)
}

function loop() {
    util.log("Waiting " + CONF.poll_interval + " ms")

    setTimeout(mainFlowControl, CONF.poll_interval)
}

function hup() {
    /* FIXME Guard configration updating, so that
     * it is not done in the middle of the run.
     */
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

function examineResults(results, threshold) {
    var stats = {
        ok: true,
        up: [],
        slow: [],
        down: []
    }

    results.forEach(function(service) {
        if (service.code != 200) {
            /* Following should be null on error, because
             * only then async.waterfall flows down.
             */
            stats.ok = null
            stats.down.push(service)
        }
        else if (service.time > threshold) {
            stats.ok = null
            stats.slow.push(service)
        }
        else {
            stats.up.push(service)
        }
    })

    return stats
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
        // http://goo.gl/UYHB6
        response.on('data', function(d){})

        callback(null, {
            name: service.name,
            code: response.statusCode,
            head: response.headers,
            time: (new Date().getTime() - atStart),
            url:  url.href
        })
    })

    request.on('error', function() {
        callback(null, {
            code: 600,
            name: service.name,
            time: 0,
            url:  url.href
        })
    })

    request.end()
}

/* * * ADMINISTRATOR NOTIFICATION * * * */

function logToStdout(stats) {
    stats.slow.forEach(function(service) {
        util.log(util.format(
            'Service %s was slow (%s ms)',
            service.name, service.time
        ))
    })

    stats.down.forEach(function(service) {
        util.log(util.format(
            'Service %s failed (%s): %s',
            service.name, service.code, service.url
        ))
    })
}

function spamPeopleWithEmail(stats) {
    var message = ''
    var title = 'ALERT:' + getServiceNames(stats.slow) + getServiceNames(stats.down)

    if (stats.slow.length > 0) {
        message += '\nSLOW:\n\n'

        stats.slow.forEach(function(service) {
            message += util.format(
                '%s (%s ms)',
                service.name, service.time
            )
        })
    }

    if (stats.down.length > 0) {
        message += '\n\nDOWN:\n\n'

        stats.down.forEach(function(service) {
            message += util.format(
                '%s (%s): %s',
                service.name, service.code, service.url
            )
        })
    }

    var mail = {
        text:    message,
        from:    CONF.mail_sender,
        to:      CONF.mail_recipients,
        subject: title
    }

    var errHandler = function errHandler(err) {
        if (err) util.log("Unable to send email, please check mail server options")
    }

    var connection = email.server.connect(CONF.mail_server_opts)

    connection.send(mail, errHandler)

    util.log("Mail sent to: " + mail.to)
}

function makePhonesBeep(stats) {
    if (stats.down.length <= 0) return

    if (!CONF.sms_recipients instanceof Array) {
        util.log("Unable to send sms, please check configuration")
    }

    var twilio = require('twilio')
    var twilioclient = new twilio.RestClient(CONF.twilio_account_sid, CONF.twilio_auth_token)

    CONF.sms_recipients.forEach(function(number) {
        var sms = {
            to:   number,
            from: CONF.twilio_from_nro,
            body: 'ALERT:' + getServiceNames(stats.down)
        }

        var callback = function(err, msg) {
            if (err) util.log("Sending text message failed")
            else { /// FIXME debug
                debug("TWILIO ONNISTUI", msg)
            }
        }

        twilioclient.sms.messages.create(sms, callback)

        util.log("SMS sent to: " + sms.to)
    })
}

function getServiceNames(arr) {
    var str = ''
    arr.forEach(function(val) { str += ' ' + val.name })
    return str
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

    /// FIXME Validate configuration somehow \\\
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
