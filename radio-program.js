'use strict';

const path = require('path');
global.personalRadioRoot = path.resolve(__dirname);

const dateGetHours = require('date-fns/getHours');
const dateFormat = require('date-fns/format');
const dateAddDays = require('date-fns/addDays');
const dateParse = require('date-fns/parse');
const dateDifferenceInSeconds = require('date-fns/differenceInSeconds');
const utcToZonedTime = require('date-fns-tz/utcToZonedTime')
const koLocale = require('date-fns/locale/ko');
const cryptoJs = require('crypto-js/sha256');
const RPTimer = require(personalRadioRoot + '/radio-timer');

module.exports = RadioProgram;

function RadioProgram() {
    this.timer = null;
    this.metaRetry = { max: 5, count: 0};

    const init = function (context) {
        this.context = context;
        this.logger = context.logger;
        this.radioCore = context.radioCore
    }

    const getKbsRadioProgram = function(station, channel, metaUrl) {
        let self=this;

        return new Promise((resolve, reject) => {
            self.radioCore.fetchRadioUrl(station, self.radioCore.baseKbsStreamUrl + metaUrl, "")
                .then((responseProgram) => {
                    let responseJson = JSON.parse(responseProgram);
                    let activeProgram = responseJson.data[0]
                    let result = {}
                    let remainingSeconds

                    if (activeProgram.end_time) {
                        remainingSeconds = self.calculateProgramFinishTime(activeProgram.end_time)
                        self.radioCore.state = {
                            station: station,
                            channel: channel,
                            programCode: activeProgram.program_code,
                            remainingSeconds: remainingSeconds,
                            metaUrl: metaUrl
                        }
                    }
                    result = {
                        ...remainingSeconds && {duration: remainingSeconds},
                        ...activeProgram.program_title && {programTitle: activeProgram.program_title},
                        ...activeProgram.relation_image && {albumart: activeProgram.relation_image},
                    }

                    resolve(result);
                })
                .catch( (error) => {
                    self.logger.error("[ControllerPersonalRadio:getKbsRadioProgram] Error=", error);
                    reject();
                })
        })
    }

    const setKbsRadioProgram = function (forceUpdate) {
        let self = this;

        const station = self.radioCore.state.station;
        const channel = self.radioCore.state.channel;
        const programCode = self.radioCore.state.programCode;
        const metaUrl = self.radioCore.state.metaUrl;

        self.radioCore.fetchRadioUrl(station, self.radioCore.baseKbsStreamUrl + metaUrl, "")
            .then( (responseProgram) => {
                let responseJson = JSON.parse(responseProgram);
                let activeProgram = responseJson.data[0]

                let vState = self.context.commandRouter.stateMachine.getState();
                let queueItem = self.context.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
                vState.seek = 0;
                vState.disableUiControls = true;

                // checking program is changed
                if (!forceUpdate && activeProgram.program_code === programCode) {
                    self.metaRetry.count ++;
                    if (self.metaRetry.count > self.metaRetry.max) {
                        vState.duration = 0;
                        queueItem.duration = 0;
                        self.metaRetry.count = 0;
                        self.context.pushState(vState);
                    }
                    else
                        self.timer = new RPTimer(self.setKbsRadioProgram.bind(this),
                            [station, channel, programCode, metaUrl, false], 10
                        );
                    return
                }

                if (activeProgram.relation_image) {
                    vState.albumart = activeProgram.relation_image;
                    queueItem.albumart = activeProgram.relation_image;
                }

                if (activeProgram.end_time) {
                    let remainingSeconds = self.calculateProgramFinishTime(activeProgram.end_time)
                    vState.duration = remainingSeconds;
                    queueItem.duration = remainingSeconds;
                    self.context.commandRouter.stateMachine.currentSongDuration= remainingSeconds;
                    self.timer = new RPTimer(
                        self.setKbsRadioProgram.bind(this),
                        [station, channel, activeProgram.program_code, metaUrl, false],
                        remainingSeconds
                    );
                }
                else {
                    vState.duration = 0;
                    queueItem.duration = 0;
                }

                if (activeProgram.program_title) {
                    vState.name = self.radioCore.radioStations.kbs[channel].title + "("
                        + activeProgram.program_title + ")";
                    queueItem.name = vState.name;
                }
                else {
                    vState.name = self.radioCore.radioStations.kbs[channel].title
                    queueItem.name = vState.name;
                }

                self.context.commandRouter.stateMachine.currentSeek = 0;  // reset Volumio timer
                self.context.commandRouter.stateMachine.playbackStart=Date.now();
                self.context.commandRouter.stateMachine.askedForPrefetch=false;
                self.context.commandRouter.stateMachine.prefetchDone=false;
                self.context.commandRouter.stateMachine.simulateStopStartDone=false;

                self.context.pushState(vState);
            })
            .catch( (error) => {
                self.logger.error("[ControllerPersonalRadio::setKbsRadioProgram] Error=", error)
            })
    }

    const setMBCSchedule = function (station, channel, programCode, metaUrl, forceUpdate) {
        let self = this;

        const mbcSchedule = "https://miniunit.imbc.com/Schedule?rtype=jsonp";
        self.radioCore.fetchRadioUrl(station, mbcSchedule, "")
            .then(function (responseProgram) {

                }
            )
    }

    const getKbsRadioSchedule = function (radioChannel, channelName) {
        let self = this;
        let metaApi = self.radioCore.kbsInfo.kbsMeta + radioChannel;
        let station = "kbs";

        self.radioCore.fetchRadioUrl(station, self.radioCore.kbsInfo.kbsTs, "")
            .then( (reqTs) => {
                // kbs program schedule
                var _0x452b92=_0x1a20;function _0x201c(){var _0x2d92e3=['11897281wJtvmJ','7422BbwuFD','10raTROq',
                    '1808682VRBHUs','23yHckar','10987461DhdIkZ','kbsAgent','3670331oUufRy','4980ZKMWmg','38414HHYqqU',
                    '8jJkVPE','920028SRWwbX'];_0x201c=function(){return _0x2d92e3;};return _0x201c();
                }(function(_0x3139b4,_0x1b2b78){var _0x54f700=_0x1a20,_0x4062ed=_0x3139b4();while(!![]){
                    try{
                        var _0x11ec42=parseInt(_0x54f700('0x1a1'))/0x1*(parseInt(_0x54f700('0x1a6'))/0x2)+
                        parseInt(_0x54f700('0x1ac'))/0x3+parseInt(_0x54f700('0x1a8'))/0x4+-
                        parseInt(_0x54f700('0x1a5'))/0x5*(parseInt(_0x54f700('0x1aa'))/0x6)+
                        parseInt(_0x54f700('0x1a4'))/0x7+-parseInt(_0x54f700('0x1a7'))/0x8*(-
                        parseInt(_0x54f700('0x1a2'))/0x9)+-parseInt(_0x54f700('0x1ab'))/0xa*(
                        parseInt(_0x54f700('0x1a9'))/0xb);
                        if(_0x11ec42===_0x1b2b78)break;else _0x4062ed['push'](_0x4062ed['shift']());
                    }
                    catch(_0x3ab66c){_0x4062ed['push'](_0x4062ed['shift']());}}}(_0x201c,0xac699));
                function _0x1a20(_0x316873,_0x37c5e2){var _0x201c03=_0x201c();
                    return _0x1a20=function(_0x1a2037,_0x2c3070){_0x1a2037=_0x1a2037-0x1a1;
                        var _0x459c94=_0x201c03[_0x1a2037];return _0x459c94;},_0x1a20(_0x316873,_0x37c5e2);
                }
                var metaUrl=Buffer['from'](metaApi+'&reqts='+reqTs+'&authcode='+
                    cryptoJs(self['radioCore']['kbsInfo'][_0x452b92('0x1a3')]+reqTs+metaApi)
                        ['toString']()['toUpperCase']())['toString']('base64')['replace'](/=/gi,'');

                self.radioCore.fetchRadioUrl(station, self.radioCore.baseKbsStreamUrl + metaUrl, "")
                    .then( (responseProgram) => {
                        let responseJson = JSON.parse(responseProgram);
                        let result = "<table><tbody>"
                        responseJson.data.map(item => {
                            let resultItem = "<tr><td>" +
                                item.start_time.substring(0,2) + ":" + item.start_time.substring(2,4) + "~" +
                                item.end_time.substring(0,2) + ":" + item.end_time.substring(2,4) + "<td>" +
                                item.program_title + "</td></tr>";
                            result = result + resultItem;
                        })
                        result = result + "</tbody></table>"
                        let modalData = {
                            title: channelName + " " + self.radioCore.getRadioI18nString('RADIO_PROGRAM'),
                            message: result,
                            size: 'lg',
                            buttons: [{
                                name: 'Close',
                                class: 'btn btn-info',
                                emit: 'closeModals',
                                payload: ''
                            }]
                        }
                        self.context.commandRouter.broadcastMessage("openModal", modalData);
                    });
            });
    }

    const calculateProgramFinishTime = function (endTime) {
        let remainingSeconds

        try {
            let endProgramHour = Number(endTime.substring(0, 2));
            let endProgramMinute = endTime.substring(2, 4);
            let nextDate;

            // get local time
            let zonedDate = utcToZonedTime(new Date(), 'Asia/Seoul');

            if (endProgramHour >= 24) {
                endProgramHour -= 24;
                let hours = dateGetHours(zonedDate)
                // check local afternoon
                if (hours > 12)
                    nextDate = dateFormat(dateAddDays(zonedDate, 1), 'MMdd');
                else
                    nextDate = dateFormat(zonedDate, 'MMdd');
            } else
                nextDate = dateFormat(zonedDate, 'MMdd');
            endProgramHour = endProgramHour.toString().padStart(2, '0');

            remainingSeconds = dateDifferenceInSeconds(
                dateParse(nextDate + endProgramHour + endProgramMinute, 'MMddHHmm', new Date(), {locale: koLocale}),
                zonedDate
            ) + 5;
        }
        catch (error) {
            this.logger.error("[ControllerPersonalRadio::calculateProgramFinishTime] Error=", error);
        }
        return remainingSeconds;
    }

    const resetRPTimer = function() {
        let self=this;

        self.timer = new RPTimer(self.setKbsRadioProgram.bind(this),
            [self.radioCore.state.station, self.radioCore.state.channel, self.radioCore.state.programCode, self.radioCore.state.metaUrl, true],
            self.radioCore.state.remainingSeconds
        );
    }

    const clearTimer = function() {
        if (this.timer) {
            this.timer.clear();
            this.timer = null;
        }
    }

    return {
        init: init,
        resetRPTimer: resetRPTimer,
        clearTimer: clearTimer,
        getKbsRadioProgram: getKbsRadioProgram,
        setKbsRadioProgram: setKbsRadioProgram,
        getKbsRadioSchedule: getKbsRadioSchedule,
        calculateProgramFinishTime: calculateProgramFinishTime
    }
}