'use strict';

const path = require('path');
global.personalRadioRoot = path.resolve(__dirname);

const libQ = require('kew');
const fs = require('fs-extra');
const fetch = require('node-fetch')
const dateGetHours = require('date-fns/getHours');
const dateFormat = require('date-fns/format');
const dateAddDays = require('date-fns/addDays');
const dateParse = require('date-fns/parse');
const dateDifferenceInSeconds = require('date-fns/differenceInSeconds');
const utcToZonedTime = require('date-fns-tz/utcToZonedTime')
const koLocale = require('date-fns/locale/ko');
const urlModule = require('url');
const querystring = require('querystring');
const crypto = require("crypto");
const cryptoJs = require('crypto-js/sha256');
const RPTimer = require(personalRadioRoot + '/radio-timer');

module.exports = RadioCore;

function RadioCore() {

    this.state = {};
    this.metaRetry = { max: 5, count: 0};
    this.timer = null;
    this.rootNavigation = {};
    this.i18nStrings = {};
    this.i18nStringsDefaults = {};
    this.rootStations = {};
    this.rootNavigation = {};
    this.radioStations = {};
    this.baseKbsStreamUrl = {};
    this.baseMbcStreamUrl = {};
    this.baseSbsStreamUrl = {};
    this.kbsInfo = {};
    this.sbsInfo = {};

    const init = function (context) {
        let self = this;
        self.context = context;
        self.logger = context.logger;

        self.loadRadioI18nStrings();
        self.addRadioResource();
    }

    const getRadioI18nString = function (key) {
        if (this.i18nStrings[key] !== undefined)
            return this.i18nStrings[key];
        else
            return this.i18nStringsDefaults[key];
    }

    const toast = function(type, message, title = this.getI18nString('PLUGIN_NAME')) {
        this.context.commandRouter.pushToastMessage(type, title, message);
    }

    const errorRadioToast = function (station, msg) {
        let self=this;

        let errorMessage = self.getRadioI18nString(msg);
        if (station !== null)
            errorMessage.replace('{0}', station.toUpperCase());
        self.context.commandRouter.pushToastMessage('error',
            self.getRadioI18nString('PLUGIN_NAME'), errorMessage);
    }

    const fetchRadioUrl = function (station, url, query) {
        let self = this;
        let defer = libQ.defer();
        let newUrl = url

        if (query) {
            newUrl = newUrl + "?" + querystring.stringify(query)
        }

        const options = {
            headers: {
                'Accept': '*/*',
                'User-Agent': 'Mozilla/5.0'
            },
            method: 'GET',
            credentials: 'same-origin'
        };

        fetch(newUrl, options)
            .then((response) => response.text())
            .then((response) => {
                defer.resolve(response);
            })
            .catch((error) => {
                if (urlModule.parse(newUrl).hostname.startsWith('raw.'))
                    self.errorRadioToast(null,'ERROR_SECRET_KEY_SERVER');
                else
                    self.errorRadioToast(station, 'ERROR_STREAM_SERVER');

                self.logger.info('ControllerPersonalRadio:fetchRadioUrl Error: ' + error);
                defer.reject(null);
            })

        return defer.promise;
    }

    const sbsExplodeUri = function(station, channel, uri, response) {
        let self = this;
        var defer = libQ.defer();

        const baseSbsStreamUrl = self.baseSbsStreamUrl + self.radioStations.sbs[channel].channel;
        self.fetchRadioUrl(station, baseSbsStreamUrl, {device: "mobile"})
            .then( (responseUrl) => {
                if (responseUrl  !== null) {
                    const decipher = crypto.createDecipheriv(self.sbsInfo.sbsAlgorithm, self.sbsInfo.sbsKey, "");
                    let streamUrl = decipher.update(responseUrl, 'base64', 'utf8');
                    streamUrl += decipher.final('utf8');

                    response = {
                        ...response,
                        uri: uri,
                        realUri: streamUrl,
                        name:  self.radioStations.sbs[channel].title
                    }
                }
                self.state = {
                    station: station
                }
                defer.resolve(response);
            });

        return defer.promise;
    }

    const mbcExplodeUri = function (station, channel, uri, response) {
        let self = this;
        var defer = libQ.defer();

        let query = {
            channel: self.radioStations.mbc[channel].channel,
            agent: "webapp",
            protocol: "M3U8",
            nocash: Math.random()
        };
        self.fetchRadioUrl(station, self.baseMbcStreamUrl, query)
            .then((responseUrl) => {
                if (responseUrl !== null) {
                    response = {
                        ...response,
                        uri: uri,
                        realUri: responseUrl,
                        name:  self.radioStations.mbc[channel].title
                    }
                }
                self.state = {
                    station: station
                }
                defer.resolve(response);
            });

        return defer.promise;
    }

    const setRadioMetaInfo = function (station, channel, programCode, metaUrl, forceUpdate) {
        let self = this;

        self.fetchRadioUrl(station, self.baseKbsStreamUrl + metaUrl, "")
            .then(function (responseProgram) {
                let responseJson = JSON.parse(responseProgram);
                let activeProgram = responseJson.data[0]

                let vState = self.context.stateMachine.getState();
                let queueItem = self.context.stateMachine.playQueue.arrayQueue[vState.position];
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
                        self.timer = new RPTimer(setRadioMetaInfo.bind(this),
                            [station, channel, programCode, metaUrl, false], 10
                        );
                    return
                }

                if (activeProgram.relation_image) {
                    vState.albumart = activeProgram.relation_image;
                    queueItem.albumart = activeProgram.relation_image;
                }

                if (activeProgram.end_time) {
                    let remainingSeconds = self.makeProgramFinishTime(activeProgram.end_time)
                    vState.duration = remainingSeconds;
                    queueItem.duration = remainingSeconds;
                    self.context.stateMachine.currentSongDuration= remainingSeconds;
                    self.timer = new RPTimer(
                        setRadioMetaInfo.bind(this),
                        [station, channel, activeProgram.program_code, metaUrl, false],
                        remainingSeconds
                    );
                }
                else {
                    vState.duration = 0;
                    queueItem.duration = 0;
                }

                if (activeProgram.program_title) {
                    vState.name = self.radioStations.kbs[channel].title + "("
                        + activeProgram.program_title + ")";
                    queueItem.name = vState.name;
                }
                else {
                    vState.name = self.radioStations.kbs[channel].title
                    queueItem.name = vState.name;
                }

                self.context.stateMachine.currentSeek = 0;  // reset Volumio timer
                self.context.stateMachine.playbackStart=Date.now();
                self.context.stateMachine.askedForPrefetch=false;
                self.context.stateMachine.prefetchDone=false;
                self.context.stateMachine.simulateStopStartDone=false;

                self.context.pushState(vState);
            })
            .fail(function (error) {
                self.logger.error("[ControllerPersonalRadio::setRadioMetaInfo] Error=", error)
            })
    }

    const setMBCSchedule = function (station, channel, programCode, metaUrl, forceUpdate) {
        let self = this;

        const mbcSchedule = "https://miniunit.imbc.com/Schedule?rtype=jsonp";
        self.fetchRadioUrl(station, mbcSchedule, "")
            .then(function (responseProgram) {

                }
            )
    }

    const makeProgramFinishTime = function (endTime) {
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
            self.logger.error("[ControllerPersonalRadio::makeProgramFinishTime] Error=", error);
        }
        return remainingSeconds;
    }

    const getRadioProgram = function (radioChannel, channelName) {
        let self = this;
        let metaApi = self.kbsInfo.kbsMeta + radioChannel;
        let station = "kbs";

        self.fetchRadioUrl(station, self.kbsInfo.kbsTs, "")
            .then(function (reqTs) {
                // kbs program schedule
                function _0x4b15(){
                    var _0x622e72=['kbsInfo','&authcode=','30780TFJSCF','4466736LkJTXV','5886yiFFrD','9giLhVb','393456nFMFeG',
                        '1834875GfsuoU','replace','2450840vgoIih','52MmrUCb','4928UjpxMf','21044SWDnyM','1485GvejIK'];
                    _0x4b15=function(){return _0x622e72;};return _0x4b15();
                }
                var _0x40cd55=_0x5366;(function(_0x1b4a08,_0x42ec4d)
                {var _0x1fe6ed=_0x5366,_0x20edc6=_0x1b4a08();while(!![]){
                    try{
                        var _0x2ada3d=parseInt(_0x1fe6ed(0xfe))/0x1*(-parseInt(_0x1fe6ed(0xfc))/0x2)+
                        parseInt(_0x1fe6ed(0xf8))/0x3+-parseInt(_0x1fe6ed(0xfb))/0x4+-
                        parseInt(_0x1fe6ed(0xf1))/0x5*(parseInt(_0x1fe6ed(0xf6))/0x6)+-
                        parseInt(_0x1fe6ed(0xf9))/0x7+-parseInt(_0x1fe6ed(0xf5))/0x8*(-
                        parseInt(_0x1fe6ed(0xf7))/0x9)+-parseInt(_0x1fe6ed(0xf4))/0xa*(-
                        parseInt(_0x1fe6ed(0xfd))/0xb);if(_0x2ada3d===_0x42ec4d)break;
                        else _0x20edc6['push'](_0x20edc6['shift']());}
                catch(_0x33cd4a){_0x20edc6['push'](_0x20edc6['shift']());}}}(_0x4b15,0x56b1e));
                function _0x5366(_0x4b3f23,_0xbd0f08){var _0x4b1594=_0x4b15();
                    return _0x5366=function(_0x53664f,_0x28f2a8){_0x53664f=_0x53664f-0xf1;
                        var _0x251ccf=_0x4b1594[_0x53664f];return _0x251ccf;},_0x5366(_0x4b3f23,_0xbd0f08);}
                var metaUrl=Buffer['from'](metaApi+'&reqts='+reqTs+_0x40cd55(0xf3)+
                    cryptoJs(self[_0x40cd55(0xf2)]['kbsAgent']+reqTs+metaApi)['toString']()['toUpperCase']())
                    ['toString']('base64')[_0x40cd55(0xfa)](/=/gi,'');

                self.fetchRadioUrl(station, self.baseKbsStreamUrl + metaUrl, "")
                    .then(function (responseProgram) {
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
                            title: channelName + " " + self.getRadioI18nString('RADIO_PROGRAM'),
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

    const resetRPTimer = function() {
        let self=this;

        self.timer = new RPTimer(setRadioMetaInfo.bind(this),
            [this.state.station, self.state.channel, self.state.programCode, self.state.metaUrl, true],
            self.state.remainingSeconds
        );
    }

    const loadRadioI18nStrings = function () {
        try {
            let language_code = this.context.commandRouter.sharedVars.get('language_code');
            this.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_'+language_code+".json");
        } catch(e) {
            this.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
        }

        this.i18nStringsDefaults=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
    };

    function decodeStreamUrl (algorithm, secretKey, encodedUri) {

        let decipherObj = crypto.createDecipher(algorithm, secretKey);
        let streamUrl = decipherObj.update(encodedUri, 'hex', 'utf8');
        streamUrl += decipherObj.final('utf8');

        return streamUrl;
    };

    const addRadioResource = function() {
        let self=this;

        let radioResource = fs.readJsonSync(__dirname+'/radio_stations.json');
        let baseNavigation = radioResource.baseNavigation;

        self.rootStations = radioResource.rootStations;
        self.radioStations = radioResource.stations;
        self.rootNavigation = JSON.parse(JSON.stringify(baseNavigation));
        self.radioNavigation = JSON.parse(JSON.stringify(baseNavigation));
        self.rootNavigation.navigation.prev.uri = '/';

        // i18n resource localization
        self.rootStations.kbs.title =  self.getRadioI18nString('KBS');
        self.rootStations.sbs.title =  self.getRadioI18nString('SBS');
        self.rootStations.mbc.title =  self.getRadioI18nString('MBC');

        self.radioStations.kbs[2].title =  self.getRadioI18nString('KBS1_RADIO');
        self.radioStations.kbs[3].title =  self.getRadioI18nString('KBS2_RADIO');
        self.radioStations.kbs[4].title =  self.getRadioI18nString('KBS3_RADIO');
        self.radioStations.kbs[5].title =  self.getRadioI18nString('KBS_WORLD');
        self.radioStations.mbc[0].title =  self.getRadioI18nString('MBC_STANDARD');
        self.radioStations.mbc[1].title =  self.getRadioI18nString('MBC_FM4U');
        self.radioStations.mbc[2].title =  self.getRadioI18nString('MBC_CHANNEL_M');
        self.radioStations.sbs[0].title =  self.getRadioI18nString('SBS_LOVE_FM');
        self.radioStations.sbs[1].title =  self.getRadioI18nString('SBS_POWER_FM');
        self.radioStations.sbs[2].title =  self.getRadioI18nString('SBS_INTERNET_RADIO');

        // Korean radio streaming server preparing
        self.fetchRadioUrl(null, radioResource.encodedRadio.radioKeyUrl, "").then(function(response) {
            let result = JSON.parse(response);
            let secretKey = result.secretKey;
            let algorithm = result.algorithm;

            self.baseKbsStreamUrl = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbs);
            self.baseMbcStreamUrl = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.mbc);
            self.baseSbsStreamUrl = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.sbs);

            self.sbsInfo = {
                sbsKey: (new Buffer(result.stationKey, 'base64')).toString('ascii'),
                sbsAlgorithm: result.algorithm2
            }
            self.kbsInfo = {
                kbsAgent: decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsAgent),
                kbsTs: decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsTs),
                kbsParam: decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsParam),
                kbsMeta: decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsMeta)
            }
        });
    };

    return {
        init: init,
        getRadioI18nString: getRadioI18nString,
        setRadioMetaInfo: setRadioMetaInfo,
        makeProgramFinishTime: makeProgramFinishTime,
        getRadioProgram: getRadioProgram,
        toast: toast,
        errorRadioToast: errorRadioToast,
        fetchRadioUrl: fetchRadioUrl,
        resetRPTimer: resetRPTimer,
        loadRadioI18nStrings: loadRadioI18nStrings,
        addRadioResource: addRadioResource,
        sbsExplodeUri: sbsExplodeUri,
        mbcExplodeUri: mbcExplodeUri
    }

}