#!/usr/bin/env nodejs

var fs       = require('fs')
var util     = require('util')
var async    = require('async')
var email    = require('emailjs')
var request  = require('request')
var hostname = require('os').hostname()

var CONF      = {}
var CONF_FILE = '/etc/nag.conf'


/* * * INIT AND QUIT  * * * * * * * * * */

function init() {
  util.puts("Initializing service threads")

  readConfig()

  CONF.target_services.forEach(function(service) {
    setTimeout(function() {
      service.fails = 0
      serviceCheckThread(service)
    }, randomInt(1000, 2000))
  })
}

function exit() {
  util.puts("Caught sigint, exiting")
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
    util.puts("Configuration read successfully")
  }
  catch (err) {
    util.puts("--")
    util.puts("Failed to parse configuration")
    util.puts("--")
    util.puts("Configuration must be valid json data and")
    util.puts("config file is expected to be found at")
    util.puts(CONF_FILE)
    util.puts("--")
    util.puts("Quitting")
    process.exit(1)
  }
}

/* * * MAIN CONTROL * * * * * * * * * * */

function serviceCheckThread(service) {
  async.waterfall([

    function sendServiceResponse(callback) {
      var ping_request_timeout = determineRequestTimeoutFromFailures(service)

      var request_config = {
        uri:     service.url,
        timeout: 30000,
        headers: { 'Connection': 'close' }
      }

      var start_time = new Date().getTime()
      var check_handled = false

      setTimeout(function() {
        if (!check_handled) {
          check_handled = true
          return callback(null, start_time, { code: 'NAG_TIMEOUT' }, false, false)
        }
      }, ping_request_timeout)

      request(request_config, function responseHandler(err, response, body) {
        if (!check_handled) {
          check_handled = true
          return callback(null, start_time, err, response, body)
        }
        else {
          logTimeout(service, start_time, err, response)
        }
      })
    },

    function handleServiceResponse(start_time, error, response, body, cb) {
      service.last_duration = new Date().getTime() - start_time
      service.last_code = error ? error.code : response.statusCode

      var nextWaitTime = service.interval || CONF.poll_default_interval

      if (service.last_code === 200) {
        logGood(service)
        service.fails = 0
      }
      else {
        service.fails += 1
        logFailure(service)
        sendServiceFailureReports(service)

        if (service.fails > 2) {
          nextWaitTime = service.fails * CONF.poll_default_interval
        }
        else {
          nextWaitTime = service.fails * CONF.poll_fail_repeat_delay
        }
      }

      return cb(null, nextWaitTime)
    }

  ],

  function scheduleNextRun(err, next_wait_time) {
    if (err) {
      util.puts("Error while processing service " + service.name + ": " + err)
      next_wait_time = CONF.poll_default_interval
    }

    setTimeout(function() { serviceCheckThread(service) }, next_wait_time)
  })
}

function determineRequestTimeoutFromFailures(srv) {
  var queryTimeout = srv.short_timeout || CONF.short_timeout
  if (srv.fails >= 1) queryTimeout = srv.long_timeout || CONF.long_timeout
  if (srv.fails >= 2) queryTimeout = srv.patient_timeout || CONF.patient_timeout
  return queryTimeout
}

function sendServiceFailureReports(srv) {
  if (srv.fails > 1)  spamPeopleWithEmail(srv)
  if (srv.fails == 2) pushAndroidNotification(srv)
  if (srv.fails > 2)  sendTextMessage(srv)
}


/* * * ADMINISTRATOR NOTIFICATION * * * */

function logGood(service) {
  if (service.fails > 0) {
    util.puts(util.format(
      'Service is good after fail #%s: %s (%s ms)',
      service.fails, service.name, service.last_duration
    ))
  }
  else {
    util.puts(util.format(
      'Service is good: %s (%s ms)',
      service.name, service.last_duration
    ))
  }
}

function logFailure(service) {
  util.puts(util.format(
    'Service failed: %s (%s) in %s ms - #%s',
    service.name, service.last_code, service.last_duration, service.fails
  ))
}

function logTimeout(service, start_time, error, response) {
  var duration = new Date().getTime() - start_time
  var returned = error ? error.code : response.statusCode

  if (returned === 'ETIMEDOUT') {
    util.puts(util.format(
      'Service never replied: %s (after %s ms)',
      service.name, duration
    ))
  }
  else {
    util.puts(util.format(
      'Timed out service replied: %s (%s after %s ms)',
      service.name, returned, duration
    ))
  }
}

function spamPeopleWithEmail(srv) {
  var subject = "ALERT: %s"

  var message = [
    "Dear reader,",
    "",
    "It should come to Your attention, that the service called %s has",
    "some issues. More specifically, error code %s was reported. The",
    "service may be queried at the following address:",
    "",
    "%s",
    "",
    "Yours faithfully,",
    "Nag process at %s"
  ].join('\n')

  var mail = {
    from:    CONF.mail_sender,
    to:      CONF.mail_recipients,
    subject: util.format(subject, srv.name),
    text:    util.format(message, srv.name, srv.last_code, srv.url, hostname)
  }

  var errHandler = function errHandler(err) {
    if (err) util.puts("Unable to send email, please check mail server")
  }

  email.server.connect(CONF.mail_server_opts).send(mail, errHandler)
  util.puts("Mail sent to: " + mail.to)
}

function pushAndroidNotification(service) {
  if (!CONF.hasOwnProperty('nma_apikey')) return
  if (!CONF.nma_apikey) return

  var id = Date.now()

  var notify_uri = 'https://www.notifymyandroid.com/publicapi/notify' +
                   '?apikey=%s&application=%s&event=%s&description=%s%3A%20%s'

  var notification = {
    uri:     util.format(notify_uri, CONF.nma_apikey, hostname,
             service.name, service.last_code, service.url),
    method:  'POST',
    timeout: 10000
  }

  util.puts(util.format('Sending Android notification (%s)', id))

  request(notification, function (error, response, body) {
    util.puts(util.format('Android notification sent (%s)', id))
  });
}

function sendTextMessage(service) {
  if (!CONF.hasOwnProperty('sms_recipients')) return
  if (!CONF.sms_recipients instanceof Array)  return

  var twilio = require('twilio')
  var twilioclient = new twilio.RestClient(
    CONF.twilio_account_sid, CONF.twilio_auth_token
  )

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

    var callback = function(err) {
      if (err) util.puts("Sending text message failed")
      else   util.puts("SMS sent to: " + sms.to)
    }

    twilioclient.sms.messages.create(sms, callback)
  })
}

process.on('SIGINT', exit)

init()
