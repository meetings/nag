/* gecko.js
 *
 * 2013-09-05 / Meetin.gs
 *
 * Pliplap pliplap...
 */

var Geckoboard = require('geckoboard-push')
var GECKO_API = null
var RAG       = []

    GECKO_API = new Geckoboard({api_key: CONF.geckoboard_api_key})

    setInterval(pushToGeckoboard, CONF.geckoboard_interval)

function pushToGeckoboard() {
    var rag = GECKO_API.rag(CONF.geckoboard_widget_key)

    rag.send(RAG, 'standard', function(err, response) {
        if (err) {
            util.log("RAG returned with an error")
        }
        else {
            util.log("RAG succeeded :-)")
        }
    })
}

module.exports.init = function init() {
    // käynnistä gecko pykäily jotenkin
}

function debug(msg, obj) {
    console.log("DEBUG :: " + msg + " ::")
    console.log(util.inspect(obj, {showHidden: true, depth: null, colors: true}))
}
