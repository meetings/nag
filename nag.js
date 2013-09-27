#!/usr/bin/env nodejs

var fs       = require('fs')
var util     = require('util')
var async    = require('async')
var email    = require('emailjs')
var request  = require('request')
var urlparse = require('url').parse
var hostname = require('os').hostname()

var CONF      = {}
var CONF_FILE = '/etc/nag.conf'

/* * * INIT AND QUIT  * * * * * * * * * */

function init() {
    util.log("Initializing service threads")

    readConfig()

    CONF.target_services.forEach(function(service) {
        setTimeout(function() {
            service.fails = 0;
            serviceCheckThread(service)
        }, randomInt(1000, 2000))
    })
}

function exit() {
    util.log("Caught sigint, exiting")

    process.exit(0)
}

function randomInt(min, max) {
    return Math.round(Math.random() * (max - min) + min)
}

/* * * READING CONFIGURATION  * * * * * */

function readConfig() {
    var file = fs.readFileSync(CONF_FILE, {encoding: 'utf8'})

    try {
        CONF = JSON.parse(file)
        util.log("Configuration read successfully")
    }
    catch (err) {
        util.log("--")
        util.log("Failed to parse configuration")
        util.log("--")
        util.log("Configuration must be valid json data and")
        util.log("config file is expected to be found at")
        util.log(CONF_FILE)
        util.log("--")
        util.log("Quitting")
        process.exit(1)
    }
}

/* * * MAIN CONTROL * * * * * * * * * * */

function serviceCheckThread(service) {
    async.waterfall([

        function sendServiceResponse( cb ){
            var ping_request_timeout = determineRequestTimeoutFromFailures( service );

            var request_configuration = {
                uri:     service.url,
                timeout: 30000, // TODO - make this configurable from conf file
                headers: { 'Connection': 'close' }
            }

            var start_time = new Date().getTime();
            var check_handled = false;

            setTimeout( function(){
                if ( !check_handled ) {
                    check_handled = true;
                    return cb( null, start_time, { code: 'NAG_TIMEOUT' }, false, false );
                }
            }, ping_request_timeout );

            request( request_configuration, function requestResponseHandler( error, response, body ) {
                if ( !check_handled ) {
                    check_handled = true;
                    return cb( null, start_time, error, response, body );
                }
                else {
                    logTimeout( service, start_time, error, response, body );
                }
            });
        },

        function handleServiceResponse( start_time, error, response, body, cb ) {
            service.last_duration = new Date().getTime() - start_time;
            service.last_code = error ? error.code : response.statusCode;

            var nextWaitTime = CONF.poll_normal_interval;

            if ( service.last_code == 200 ) {
                logGood( service );

                service.fails = 0;
            }
            else {
                service.fails += 1;

                logFailure( service );

                sendServiceFailureReports( service );

                if (service.fails > 2) {
                    nextWaitTime = service.fails * CONF.poll_normal_interval;
                }
                else {
                    nextWaitTime = CONF.poll_fail_repeat_delay;
                }
            }

            return cb( null, nextWaitTime );
        }

    ], function scheduleNextRun( err, next_wait_time ) {
        if ( err ) {
            util.log( "Error while processing service " + service.name + ": " + err );
            next_wait_time = CONF.poll_normal_interval;
        }

        setTimeout(function() { serviceCheckThread(service) }, next_wait_time );
    } );
}

function determineRequestTimeoutFromFailures( service ) {
    var queryTimeout = service.short_timeout || CONF.short_timeout
    if (service.fails >= 1) queryTimeout = service.long_timeout || CONF.long_timeout
    if (service.fails >= 2) queryTimeout = service.patient_timeout || CONF.patient_timeout

    return queryTimeout;
}


function sendServiceFailureReports( service ) {
    if (service.fails > 1) {
        spamPeopleWithEmail(service);
    }

    if (service.fails > 2) {
        makePhonesBeep(service);
    }
}


/* * * ADMINISTRATOR NOTIFICATION * * * */

function logGood(service) {
    if ( service.fails > 0 ) {
        util.log(util.format(
            'Service is good after fail #%s: %s (%s ms)',
            service.fails, service.name, service.last_duration
        ))
    }
    else {
        util.log(util.format(
            'Service is good: %s (%s ms)',
            service.name, service.last_duration
        ))
    }
}

function logFailure(service) {
    util.log(util.format(
        'Service failed: %s (%s) in %s ms - #%s',
        service.name, service.last_code, service.last_duration, service.fails
    ))
}

function logTimeout(service, start_time, error, response, body ) {
    var last_duration = new Date().getTime() - start_time;
    var returned = error ? error.code : response.statusCode;

    util.log(util.format(
        'Timed out service returned: %s (%s) in %s ms',
        service.name, returned, last_duration
    ))
}

function spamPeopleWithEmail(service) {
    var subject = 'ALERT: ' + service.name

    var message = util.format(
"Dear reader,\n\
\n\
It should come to Your attention, that the service called %s has some\n\
issues. More specifically, error code %s was reported. The\n\
service may be queried at the following address:\n\
\n\
%s\n\
\n\
Yours faithfully,\n\
Nag process at %s\n", service.name, service.last_code, service.url, hostname)

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
        return
    }

    var twilio = require('twilio')
    var twilioclient = new twilio.RestClient(CONF.twilio_account_sid, CONF.twilio_auth_token)

    var message = util.format(
        'ALERT (%s): %s [%s]',
        hostname, service.name, service.last_code
    )

    CONF.sms_recipients.forEach(function(number) {
        var sms = {
            to:   number,
            from: CONF.twilio_from_nro,
            body: message
        }

        var callback = function(err, msg) {
            if (err) util.log("Sending text message failed")
            else     util.log("SMS sent to: " + sms.to)
        }

        twilioclient.sms.messages.create(sms, callback)
    })
}

process.on('SIGINT', exit)

init()
