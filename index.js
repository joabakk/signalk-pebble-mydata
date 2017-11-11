const signalkSchema = require('@signalk/signalk-schema')
const Bacon = require('baconjs')
var express = require("express")
const debug = require('debug')('signalk-pebble-mydata')
const _ = require('lodash')
const util = require('util')


const relevantKeys = Object.keys(signalkSchema.metadata)
.filter(s => s.indexOf('/vessels/*') >= 0)
.map(s => s.replace('/vessels/*', '').replace(/\//g, '.').replace(/RegExp/g, '*').substring(1)).sort()

var jsonContent = ""
var refresh, vibrate, font, scroll, light, blink, updown, elements

module.exports = function(app) {
  var plugin = {}
  var unsubscribes = []

  plugin.id = "signalk-pebble-mydata"
  plugin.name = "Pebble Mydata"
  plugin.description = "A signalk node plugin to show boat data on Pebble smartwatch"

  plugin.schema = {
    type: "object",
    title: "A signalk node plugin to show boat data on Pebble smartwatch",
    description: "Point your MyData app to the address: http://<IP>:<port>/plugins/" + plugin.id + "/pebble.json",
    required: [
      "refresh", "vibrate", "font", "theme", "scroll", "light", "blink", "updown"
    ],

    properties: {
      refresh: {
        type: "number",
        title: "Refresh rate in seconds",
        default: 3
      },
      vibrate: {
        type: "number",
        title: "Vibration",
        default: 0,
        "enum": [0,1,2,3],
        enumNames: ["Don't vibrate", "Short vibrate", "Double vibrate", "Long vibrate)"]
      },
      font: {
        type: "number",
        title: "Font size",
        default: 5,
        "enum": [1,2,3,4,5,6,7,8],
        enumNames: ["GOTHIC_14", "GOTHIC_14_BOLD", "GOTHIC_18", "GOTHIC_18_BOLD", "GOTHIC_24", "GOTHIC_24_BOLD", "GOTHIC_28", "GOTHIC_28_BOLD"]
      },
      theme: {
        type: "number",
        title: "Theme, 0 for black and 1 for white",
        default: 0,
        "enum": [0,1],
        enumNames: ["black", "white"]
      },
      scroll: {
        type: "number",
        title: "Scroll content to offset (as percentage 0..100). If param not defined or >100 - position will be kept.",
        default: 33
      },
      light: {
        type: "number",
        title: "Background light",
        default: 0,
        "enum": [0,1],
        enumNames: ["Do nothing", "Turn Pebble light on for short time"]
      },
      blink: {
        type: "number",
        title: "1..10 - Blink content count (blinks with black/white for \"count\" times)",
        default: 0,
        "enum": [0,1,2,3,4,5,6,7,8,9,10]
      },
      updown: {
        type: "number",
        title: "Up/Down buttons",
        default: 0,
        "enum": [0,1],
        enumNames: ["Use up/down buttons for scrolling", "Use up/down buttons for update, appending up=1|2/down=1|2 params (1=short/2=long)"]
      },
      elements: {
        type: "array",
        title: " ",
        items: {
          title: "Data to display",
          type: "object",
          properties: {
            "active": {
              title: "Active",
              type: "boolean",
              default: true
            },
            "key": {
              title: "Signal K Path",
              type: "string",
              default: "",
              "enum": [
                "environment.current.setTrue",
                "environment.current.setMagnetic",
                "environment.current.drift",
                "performance.polarSpeedRatio.value",
                "performance.targetAngle.value",
                "performance.targetSpeed.value",
                "navigation.speedOverGround.value",
              ]
            },
            "show": {
              title: "Show as",
              type: "string",
              default: "",
              "description": "Short name for small screen",

            },
            "conversion": {
              title: "Convert",
              type: "string",
              default: "none",
              "description": "Convert from SI to display units",
              "enum": ["none", "rad_deg", "rad_card", "ms_kn", "ratio_percent"],
              enumNames: ["none", "radians to deg", "radians to Cardinal (SW, NE, SSW)", "m/s to knots", "ratio to percent"]

            },
            "units": {
              title: "Show unit",
              type: "boolean",
              default: false,
              "description": "Show unit after value on Pebble"

            }
          }
        }
      }
    }
  }


  plugin.start = function(props) {

    refresh = props.refresh
    vibrate = props.vibrate
    font = props.font
    theme = props.theme
    scroll = props.scroll
    light = props.light
    blink = props.blink
    updown = props.updown
    elements = props.elements
    debug("starting...")
    debug("elements: " + util.inspect(elements))
    debug("started")

    unsubscribes = (props.elements || []).reduce((acc, {
      key,
      active,
      show,
      conversion,
    }) => {
      if(active) {

        var stream = app.streambundle.getSelfStream(key)
        const tests = elements.map((element, i) => {
        })
        acc.push(stream.map(value => {
          return tests.findIndex(test => test(value))
        }).skipDuplicates().onValue(elementIndex => {
          addToJson(key, elementIndex, show, conversion)
        }))
      }
      return acc
    }, [])
    return true
  }


  plugin.registerWithRouter = function(router) {
    router.get("/pebble.json", (req, res) => {
      res.contentType('application/json')
      json = sendCommand(elements)
      res.send(json)
    })
  }

  function sendCommand(elements)
  {
    debug(util.inspect(elements))
    const tests = elements.map((element, i) => {
      var keyValue = _.get(app.signalk.self, element.key)
      if (typeof keyValue == 'undefined'){
        var valueKey = element.key + ".value"
        keyValue = _.get(app.signalk.self, valueKey)
      }

      if (element.conversion != "none"){
        if (element.conversion == "rad_deg"){keyValue *= (180 / Math.PI)}
        if (element.conversion == "rad_card"){
          keyValue *= (180 / Math.PI)
          //only temporary
        }
        if (element.conversion == "ms_kn"){keyValue *= (3600/1852)}
        if (element.conversion == "ratio_percent"){keyValue *= 100}
      }
      if (typeof keyValue == 'undefined'){keyValue = "N/A"}else{keyValue = keyValue.toFixed(2)}
      var displayUnit = ""
      if (element.units == true){
        if (element.conversion == "rad_deg"){displayUnit = "\xB0"}
        if (element.conversion == "rad_card"){
          keyValue = getCardinal(keyValue)
          displayUnit = ""
        }
        if (element.conversion == "ms_kn"){displayUnit = " kn"}
        if (element.conversion == "ratio_percent"){displayUnit = " %"}
      }
      jsonContent += element.show + ": " + keyValue + displayUnit + "\n"
    })
    debug("jsonContent: " + jsonContent)


    var json = ({
      "content": jsonContent,
      "refresh": refresh,
      "vibrate": vibrate,
      "font": font,
      "theme": theme,
      "scroll": scroll,
      "light": light,
      "blink": blink,
      "updown": updown
    })
    jsonContent = ""

    return json


  }


  plugin.stop = function() {
    unsubscribes.forEach(f => f())
    unsubscribes = []
  }
  return plugin
}

//given "0-360" returns the nearest cardinal direction "N/NE/E/SE/S/SW/W/NW/N"
function getCardinal(angle) {
  //easy to customize by changing the number of directions you have
  var directions = 8;

  var degree = 360 / directions;
  angle = angle + degree/2;

  if (angle >= 0 * degree && angle < 1 * degree)
  return "N";
  if (angle >= 1 * degree && angle < 2 * degree)
  return "NE";
  if (angle >= 2 * degree && angle < 3 * degree)
  return "E";
  if (angle >= 3 * degree && angle < 4 * degree)
  return "SE";
  if (angle >= 4 * degree && angle < 5 * degree)
  return "S";
  if (angle >= 5 * degree && angle < 6 * degree)
  return "SW";
  if (angle >= 6 * degree && angle < 7 * degree)
  return "W";
  if (angle >= 7 * degree && angle < 8 * degree)
  return "NW";
  //Should never happen:
  return "N";
}
