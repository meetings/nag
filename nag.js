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
        function initialQuery() {
            queryService(service, CONF.short_timeout, this)
        },

        function initialResultCheck(err, result) {
            checkForFailure(result, this)
        },

        function logIfErrorsAndQueryAgain(err, result) {
            if (err == null) this(err, result)

            debug("AFTER FIRST CHECK", result)

            logStatus(result)

            var context = this

            setTimeout(function() {
                queryService(result, CONF.long_timeout, context)
            }, CONF.poll_repeat_delay)
        },

        function checkResultsAgain(err, result) {
            checkForFailure(result, this)
        },

        function sendEmailIfErrorsAndQueryYetAgain(err, result) {
            if (err == null) this(err, result)

            logStatus(result)
            spamPeopleWithEmail(result)

            var context = this

            setTimeout(function() {
                queryService(result, CONF.patient_timeout, context)
            }, CONF.poll_repeat_delay)
        },

        function checkErrorsForTheLastTime(err, result) {
            checkForFailure(result, this)
        },

        function sendTextMessageIfErrorsAndLoop(err, result) {
            if (err == null) this(err, result)

            logStatus(result)
            makePhonesBeep(result)

            setTimeout(function() {
                serviceCheckThread(result)
            }, CONF.poll_interval)
        }
    )
}

function checkForFailure(result, callback) {
    if (result.code != 200) {
        debug("VIRHE TULOKSESSA", result)
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
                name: service.name,
                code: error.code,
                time: 0,
                url:  service.url
            })
        }
        else {
            callback(null, {
                name: service.name,
                code: response.statusCode,
                time: (new Date().getTime() - atStart),
                url:  service.url
            })
        }
    })
}

/* * * ADMINISTRATOR NOTIFICATION * * * */

function logStatus(service) {
    util.log(util.format(
        'Slow service: %s (%s ms)',
        service.name, service.time
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
            else { /// FIXME debug
                debug("TWILIO ONNISTUI", msg)
            }
        }

        /// FIXME debug twilioclient.sms.messages.create(sms, callback)

        util.log("SMS sent to: " + sms.to)
    })
}

process.on('SIGINT', exit)

init()

/* * * DEBUG  * * * * * * * * * * * * * */

function debug(msg, obj) {
    console.log("DEBUG :: " + msg + " ::")
    console.log(util.inspect(obj, {showHidden: true, depth: 1, colors: true}))
}

process.on('uncaughtException', function(err) {
    debug("UNCAUGHTEXCEPTION", err)
    process.exit(1)
})
