'use strict';

const path = require('path');
global.personalRadioRoot = path.resolve(__dirname);

const libQ = require('kew');
const fs = require('fs-extra');
const fetch = require('node-fetch')
const urlModule = require('url');
const querystring = require('querystring');
const crypto = require("crypto");
const cryptoJs = require('crypto-js/sha256');

module.exports = RadioCore;

function RadioCore() {
    this.state = {};
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

        return new Promise((resolve, reject) => {
            fetch(newUrl, options)
                .then((response) => response.text())
                .then((response) => {
                    resolve(response);
                })
                .catch((error) => {
                    if (urlModule.parse(newUrl).hostname.startsWith('raw.'))
                        self.errorRadioToast(null, 'ERROR_SECRET_KEY_SERVER');
                    else
                        self.errorRadioToast(station, 'ERROR_STREAM_SERVER');

                    self.logger.info('ControllerPersonalRadio:fetchRadioUrl Error: ' + error);
                    reject(null);
                })
        })
    }

    const kbsExplodeUri = function (station, channel, uri, response) {
        let self = this;
        let defer = libQ.defer();

        let radioChannel = self.radioStations.kbs[channel].channel;
        self.fetchRadioUrl(station, self.kbsInfo.kbsTs, "")
            .then(function (reqTs) {
                var _0x3057e1=_0x50b9;function _0x3ca8(){var _0x4cb98f=['3071618qisgfS','&reqts=','4635561aRCNYS',
                    '5105564DZAmLO','4912giKxFs','6345486bglSjP','1kkeuSK','kbsInfo','kbsAgent','9518940KdOAIA',
                    '1621880ERlAKF','62631VoAYYC','base64','toString','replace'];_0x3ca8=function(){return _0x4cb98f;
                    };return _0x3ca8();}(function(_0x4b04e2,_0x4c52d8){
                var _0xf66d51=_0x50b9,_0x43b488=_0x4b04e2();while(!![]){
                    try{
                        var _0x3af0da=-parseInt(_0xf66d51('0x143'))/0x1*(
                        parseInt(_0xf66d51('0x14c'))/0x2)+-parseInt(_0xf66d51('0x13f'))/0x3+-
                        parseInt(_0xf66d51('0x140'))/0x4+parseInt(_0xf66d51('0x147'))/0x5+
                        parseInt(_0xf66d51('0x146'))/0x6+-parseInt(_0xf66d51('0x142'))/0x7+
                        parseInt(_0xf66d51('0x141'))/0x8*(parseInt(_0xf66d51('0x148'))/0x9);
                        if(_0x3af0da===_0x4c52d8)break;else _0x43b488['push'](_0x43b488['shift']());
                    }
                    catch(_0x3e3476){_0x43b488['push'](_0x43b488['shift']());}}}(_0x3ca8,0xe08ff));
                function _0x50b9(_0x52d001,_0x126a6d){var _0x3ca8f3=_0x3ca8();return _0x50b9=function(_0x50b953,_0x3e92c3)
                {_0x50b953=_0x50b953-0x13e;var _0x46a22=_0x3ca8f3[_0x50b953];return _0x46a22;},
                    _0x50b9(_0x52d001,_0x126a6d);}var paramApi=self['kbsInfo']['kbsParam']+radioChannel,
                    metaApi=self['kbsInfo']['kbsMeta']+radioChannel,
                    streamUrl=Buffer['from'](paramApi+_0x3057e1('0x13e')+reqTs+'&authcode='+
                        cryptoJs(self['kbsInfo'][_0x3057e1('0x145')]+reqTs+paramApi)
                            [_0x3057e1('0x14a')]()['toUpperCase']())['toString']
                    (_0x3057e1('0x149'))[_0x3057e1('0x14b')](/=/gi,''),
                    metaUrl=Buffer['from'](metaApi+_0x3057e1('0x13e')+reqTs+'&authcode='+
                        cryptoJs(self[_0x3057e1('0x144')]['kbsAgent']+reqTs+metaApi)
                            ['toString']()['toUpperCase']())['toString']('base64')['replace'](/=/gi,'');

                let fetches = [
                    self.fetchRadioUrl(station, self.baseKbsStreamUrl + streamUrl, ""),
                    self.context.radioProgram.getKbsRadioProgram(station, channel, metaUrl)
                ];
                Promise.all(fetches).then( results => {
                    let [responseUrl, responseProgram] = results;

                    if (responseUrl !== null) {
                        response = {
                            ...response,
                            uri: uri,
                            realUri: JSON.parse(responseUrl).real_service_url,
                            name: self.radioStations.kbs[channel].title,
                            disableUiControls: true
                        }
                    }
                    response = {
                        ...response,
                        ...responseProgram.duration && {duration: responseProgram.duration},
                        ...responseProgram.programTitle && {program: responseProgram.programTitle},
                        ...responseProgram.albumart && {albumart: responseProgram.albumart}
                    }

                    defer.resolve(response)
                })
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
        let defer = libQ.defer();

        let query = {
            channel: self.radioStations.mbc[channel].channel,
            agent: "webapp",
            protocol: "M3U8",
            nocash: Math.random()
        };
        self.fetchRadioUrl(station, self.baseMbcStreamUrl, query)
            .then((responseUrl) => {
                if (responseUrl !== null) {
                    const responseProgram = self.context.radioProgram.getMbcRadioProgram(station, channel)

                    response = {
                        ...response,
                        uri: uri,
                        realUri: responseUrl,
                        name: self.radioStations.mbc[channel].title,
                        ...responseProgram.duration && {duration: responseProgram.duration},
                        ...responseProgram.programTitle && {program: responseProgram.programTitle},
                        ...responseProgram.albumart && {albumart: responseProgram.albumart}
                    }
                }
                defer.resolve(response);
            });

        return defer.promise;
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
        toast: toast,
        errorRadioToast: errorRadioToast,
        fetchRadioUrl: fetchRadioUrl,
        loadRadioI18nStrings: loadRadioI18nStrings,
        addRadioResource: addRadioResource,
        kbsExplodeUri: kbsExplodeUri,
        sbsExplodeUri: sbsExplodeUri,
        mbcExplodeUri: mbcExplodeUri
    }
}