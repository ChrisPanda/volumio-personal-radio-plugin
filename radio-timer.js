'use strict';

const NanoTimer = require('nanotimer');

module.exports = RPTimer;

function RPTimer(callback, args, delay) {
    let remaining = delay;

    var nanoTimer = new NanoTimer();

    RPTimer.prototype.start = function () {
        nanoTimer.clearTimeout();
        nanoTimer.setTimeout(callback, args, remaining + 's');
    };

    RPTimer.prototype.clear = function () {
        nanoTimer.clearTimeout();
    };

    this.start();
};
