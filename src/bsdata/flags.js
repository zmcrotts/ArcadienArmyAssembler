"use strict";

function bsdataFlagIsTrue(value) {
  return value === true
    || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function bsdataFlagIsFalse(value) {
  return value === false
    || (typeof value === "string" && value.trim().toLowerCase() === "false");
}

module.exports = { bsdataFlagIsFalse, bsdataFlagIsTrue };
