'use strict';

const path = require('path');
global.personalRadioRoot = path.resolve(__dirname);

const libQ = require('kew');
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

    const init = function (context) {
        let self = this
        self.context = context;
        self.logger = context.logger;

        loadRadioI18nStrings();
        addRadioResource();
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

    const setRadioMetaInfo = function (station, channel, programCode, metaUrl, forceUpdate) {
        let self = this;

        self.fetchRadioUrl(station, self.baseKbsStreamUrl + metaUrl, "")
            .then(function (responseProgram) {
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
                        self.timer = new RPTimer(self.setRadioMetaInfo.bind(self),
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
                    self.context.commandRouter.stateMachine.currentSongDuration= remainingSeconds;
                    self.timer = new RPTimer(
                        self.setRadioMetaInfo.bind(self),
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

                self.context.commandRouter.stateMachine.currentSeek = 0;  // reset Volumio timer
                self.context.commandRouter.stateMachine.playbackStart=Date.now();
                self.context.commandRouter.stateMachine.askedForPrefetch=false;
                self.context.commandRouter.stateMachine.prefetchDone=false;
                self.context.commandRouter.stateMachine.simulateStopStartDone=false;

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
        let metaApi = self.baseKbsMeta + radioChannel;
        let station = "kbs";

        self.fetchRadioUrl(station, self.baseKbsTs, "")
            .then(function (reqTs) {
                // kbs program schedule
                let i=b;
                function b(c,d){var e=a();return b=function(f,g){f=f-0x138;var h=e[f];return h;},b(c,d);}
                function a(){
                    var j=['15LIWwkS','16UAVeIp','&reqts=','3bxfVLP','559293EejudT','360616tkTSZB','54607dNTtoi','4161618mOpHkv','20790890WVREXt','2932134OeCvsu','644806HGXerh'];
                    a=function(){return j;};return a();}
                (function(c,d){var h=b,e=c();while(!![])
                {try{var f=-parseInt(h(0x13b))/0x1+parseInt(h(0x13f))/0x2*(-parseInt(h(0x138))/0x3)+
                    parseInt(h(0x13a))/0x4*(-parseInt(h(0x140))/0x5)+-
                        parseInt(h(0x13e))/0x6+-parseInt(h(0x139))/0x7*(parseInt(h(0x141))/0x8)+-
                        parseInt(h(0x13c))/0x9+parseInt(h(0x13d))/0xa;if(f===d)break;
                else e['push'](e['shift']());}catch(g){e['push'](e['shift']());}}}(a,0x4e4d8));
                let metaUrl=Buffer['from'](metaApi+i(0x142)+reqTs+'&authcode='+
                    cryptoJs(self['basekbsAgent']+reqTs+metaApi)
                        ['toString']()['toUpperCase']())['toString']('base64')['replace'](/=/gi,'');

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
        let self=this

        self.timer = new RPTimer(self.setRadioMetaInfo.bind(self),
            [self.state.station, self.state.channel, self.state.programCode, self.state.metaUrl, true],
            self.state.remainingSeconds
        );
    }

    function loadRadioI18nStrings () {
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

    function addRadioResource() {
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
            self.sbsKey = (new Buffer(result.stationKey, 'base64')).toString('ascii');
            self.sbsAlgorithm = result.algorithm2;

            self.baseKbsStreamUrl = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbs);
            self.baseMbcStreamUrl = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.mbc);
            self.baseSbsStreamUrl = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.sbs);

            self.basekbsAgent = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsAgent);
            self.baseKbsTs = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsTs);
            self.baseKbsParam = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsParam);
            self.baseKbsMeta = decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsMeta);
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
        resetRPTimer: resetRPTimer()
    }

}