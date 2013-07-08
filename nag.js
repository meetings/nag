#!/usr/bin/env nodejs

var fs       = require('fs')
var util     = require('util')
var step     = require('step')
var email    = require('emailjs')
var request  = require('request')
var urlparse = require('url').parse

var CONF = {}
var CONFIG_FILE = '/etc/nag.conf'

/* * * INIT * * * * * * * * * * * * * * */

function init() {
    util.log("Initializing service threads")

    readConfig()

    CONF.target_services.forEach(function(service) {
        setTimeout(function() {
            serviceCheckThread(service)
        }, 1000)
    })
}

/* * * READING CONFIGURATION  * * * * * */

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
}

/* * * MAIN CONTROL * * * * * * * * * * */

function serviceCheckThread(service) {
    step(
        function queryTheService() {
            var                     queryTimeout = CONF.short_timeout
            if (service.fails >= 1) queryTimeout = CONF.long_timeout
            if (service.fails >= 2) queryTimeout = CONF.patient_timeout

            queryService(service, queryTimeout, this)
        },

        function lookForErrorsInResults(err, result) {
            checkForFailure(result, this)
        },

        function actIfThereWereErrors(err, result) {
            var nextTimeout = 0

            if (result.fails === undefined) result.fails = 0

            if (err) {
                result.fails += 1
                nextTimeout = CONF.poll_quick_repeat

                logFailure(result)

                if (result.fails > 1) {
                    spamPeopleWithEmail(result)
                }

                if (result.fails > 2) {
                    makePhonesBeep(result)
                    nextTimeout = CONF.poll_normal_interval
                }
            }
            else {
                if (result.fails != 0) logGood(result)

                result.fails = 0
                nextTimeout = CONF.poll_normal_interval
            }

            setTimeout(function() { serviceCheckThread(result) }, nextTimeout)
        }
    )
}

function checkForFailure(result, callback) {
    if (result.code != 200) {
        callback(true, result)
    }

    callback(null, result)
}

function exit() {
    util.log("Caught sigint, exiting")

    process.exit(0)
}

/* * * SENDING HTTP REQUESTS  * * * * * */

function queryService(service, timeout, callback) {
    var atStart = new Date().getTime()

    var query = {
        uri:     service.url,
        timeout: timeout,
        headers: { 'Connection': 'close' }
    }

    request(query, function(error, response, body) {
        if (error) {
            callback(null, {
                name:  service.name,
                code:  error.code,
                time:  0,
                url:   service.url,
                fails: service.fails
            })
        }
        else {
            callback(null, {
                name:  service.name,
                code:  response.statusCode,
                time:  (new Date().getTime() - atStart),
                url:   service.url,
                fails: service.fails
            })
        }
    })
}

/* * * ADMINISTRATOR NOTIFICATION * * * */

function logGood(service) {
    util.log(util.format(
        'Service is good: %s (%s ms)',
        service.name, service.time
    ))
}

function logFailure(service) {
    util.log(util.format(
        'Service failed: %s (%s) in %s ms',
        service.name, service.code, service.time
    ))
}

function spamPeopleWithEmail(service) {
    var subject = 'ALERT: ' + service.name

    var message = util.format(
"Dear reader,\n\
\n\
It should come to Your attention, that the service called %s has some\n\
issues. More specifically, error code %s was reported. The service may\n\
be queried at the following address:\n\
\n\
%s\n\
\n\
With regards,\n\
your faithful nag tool\n", service.name, service.code, service.url)

    var mail = {
        from:    CONF.mail_sender,
        to:      CONF.mail_recipients,
        subject: subject,
        text:    message,
    }

    var errHandler = function errHandler(err) {
        if (err) util.log("Unable to send email, please check mail server options")
    }

    var connection = email.server.connect(CONF.mail_server_opts)

    connection.send(mail, errHandler)

    util.log("Mail sent to: " + mail.to)
}

function makePhonesBeep(service) {
    if (!CONF.sms_recipients instanceof Array) {
        util.log("Unable to send sms, please check configuration")
    }

    var twilio = require('twilio')
    var twilioclient = new twilio.RestClient(CONF.twilio_account_sid, CONF.twilio_auth_token)

    CONF.sms_recipients.forEach(function(number) {
        var sms = {
            to:   number,
            from: CONF.twilio_from_nro,
            body: 'ALERT: ' + service.name
        }

        var callback = function(err, msg) {
            if (err) util.log("Sending text message failed")
            else { /// FIXME DEBUG
                debug("TWILIO ONNISTUI", msg)
            }
        }

        twilioclient.sms.messages.create(sms, callback)

        util.log("SMS sent to: " + sms.to)
    })
}

process.on('SIGINT', exit)

init()

/* * * DEBUG  * * * * * * * * * * * * * */

function debug(msg, obj) {
    console.log("DEBUG :: " + msg + " ::")
    console.log(util.inspect(obj, {showHidden: true, depth: 0, colors: true}))
}

process.on('uncaughtException', function(err) {
    debug("UNCAUGHTEXCEPTION", err)
    process.exit(1)
})
