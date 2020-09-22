'use strict';

// This Volumio plugin provides Korean radios (SBS, KBS, MBC) and Linn radio.

var libQ = require('kew');
var fs = require('fs-extra');
var config = require('v-conf');
var unirest = require('unirest');
var crypto = require('crypto');
var cryptoJs = require('crypto-js/sha256');
var NanoTimer = require('nanotimer');
var dateGetHours = require('date-fns/getHours');
var dateFormat = require('date-fns/format');
var dateAddDays = require('date-fns/addDays');
var dateParse = require('date-fns/parse');
var dateDifferenceInSeconds = require('date-fns/differenceInSeconds');
var utcToZonedTime = require('date-fns-tz/utcToZonedTime')
var koLocale = require('date-fns/locale/ko');

module.exports = ControllerPersonalRadio;

function ControllerPersonalRadio(context) {
	var self = this;

  self.context = context;
  self.commandRouter = this.context.coreCommand;
  self.logger = this.context.logger;
  self.configManager = this.context.configManager;
  self.state = {};
  self.metaRetry = { max: 5, count: 0};
  self.timer = null;
  self.stateMachine = self.commandRouter.stateMachine;

  self.logger.info("ControllerPersonalRadio::constructor");
}

ControllerPersonalRadio.prototype.onVolumioStart = function()
{
  var self = this;

  self.configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
  self.getConf(self.configFile);
  self.sbsProtocol =  self.config.get('sbsProtocol');
  self.mbcProtocol =  self.config.get('mbcProtocol');

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerPersonalRadio.prototype.onStart = function() {
  var self = this;

  self.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service','mpd');

  self.loadRadioI18nStrings();
  self.addRadioResource();
  self.addToBrowseSources();

  self.serviceName = "personal_radio";

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onStop = function() {
  var self = this;

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onRestart = function() {
  var self = this;

  return libQ.resolve();
};


// Configuration Methods -----------------------------------------------------
ControllerPersonalRadio.prototype.getConf = function(configFile) {
  var self = this;

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
};

ControllerPersonalRadio.prototype.setConf = function(conf) {
  var self = this;

  fs.writeJsonSync(self.configFile, JSON.stringify(conf));
};

ControllerPersonalRadio.prototype.getUIConfig = function() {
  var self = this;
  var defer = libQ.defer();
  var lang_code = this.commandRouter.sharedVars.get('language_code');

  self.getConf(this.configFile);
  self.commandRouter.i18nJson(__dirname+'/i18n/strings_' + lang_code + '.json',
      __dirname + '/i18n/strings_en.json',
      __dirname + '/UIConfig.json')
  .then(function(uiconf)
  {
    uiconf.sections[0].content[0].value = self.config.get('sbsProtocol');
    uiconf.sections[0].content[1].value = self.config.get('mbcProtocol');

    defer.resolve(uiconf);
  })
  .fail(function()
  {
    defer.reject(new Error());
  });

  return defer.promise;
};

ControllerPersonalRadio.prototype.setUIConfig = function(data)
{
  var self = this;

  var uiconf=fs.readJsonSync(__dirname+'/UIConfig.json');

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.updateConfig = function (data) {
  var self = this;
  var defer = libQ.defer();
  var configUpdated = false;

  if (self.config.get('sbsProtocol') != data['sbsProtocol']) {
    self.config.set('sbsProtocol', data['sbsProtocol']);
    self.sbsProtocol = data['sbsProtocol'];
    configUpdated = true;
  }

  if (self.config.get('mbcProtocol') != data['mbcProtocol']) {
    self.config.set('mbcProtocol', data['mbcProtocol']);
    self.mbcProtocol = data['mbcProtocol'];
    configUpdated = true;
  }

  if(configUpdated) {
    var responseData = {
      title: self.getRadioI18nString('PLUGIN_NAME'),
      message: self.getRadioI18nString('STOP_RADIO_STATION'),
      size: 'md',
      buttons: [{
        name: 'Close',
        class: 'btn btn-info'
      }]
    };

    self.commandRouter.broadcastMessage("openModal", responseData);
  }

  return defer.promise;
};

// Playback Controls ---------------------------------------------------------
ControllerPersonalRadio.prototype.addToBrowseSources = function () {
  var self = this;

  self.commandRouter.volumioAddToBrowseSources({
    name: self.getRadioI18nString('PLUGIN_NAME'),
    uri: 'kradio',
    plugin_type: 'music_service',
    plugin_name: "personal_radio",
    albumart: '/albumart?sourceicon=music_service/personal_radio/personal_radio.svg'
  });
};

ControllerPersonalRadio.prototype.handleBrowseUri = function (curUri) {
  var self = this;
  var response;

  if (curUri.startsWith('kradio')) {
    if (curUri === 'kradio') {
      response = self.getRootContent();
    }
    else if (curUri === 'kradio/kbs') {
      response = self.getRadioContent('kbs');
    }
    else if (curUri === 'kradio/sbs') {
        response = self.getRadioContent('sbs');
    }
    else if (curUri === 'kradio/mbc') {
      response = self.getRadioContent('mbc');
    }
    else if (curUri === 'kradio/linn') {
      response = self.getRadioContent('linn');
    }
    else {
      response = libQ.reject();
    }
  }

  return response
    .fail(function (e) {
      self.logger.info('[' + Date.now() + '] ' + 'ControllerPersonalRadio::handleBrowseUri failed');
      libQ.reject(new Error());
    });
};

ControllerPersonalRadio.prototype.getRootContent = function() {
  var self=this;
  var response;
  var defer = libQ.defer();

  response = self.rootNavigation;
  response.navigation.lists[0].items = [];
  for (var key in self.rootStations) {
      var radio = {
        service: self.serviceName,
        type: 'folder',
        title: self.rootStations[key].title,
        icon: 'fa fa-folder-open-o',
        uri: self.rootStations[key].uri
      };
      response.navigation.lists[0].items.push(radio);
  }
  defer.resolve(response);
  return defer.promise;
};

ControllerPersonalRadio.prototype.getRadioContent = function(station) {
  var self=this;
  var response;
  var radioStation;
  var defer = libQ.defer();

  switch (station) {
    case 'kbs':
      radioStation = self.radioStations.kbs;
      break;
    case 'sbs':
      radioStation = self.radioStations.sbs;
      break;
    case 'mbc':
      radioStation = self.radioStations.mbc;
      break;
    case 'linn':
      radioStation = self.radioStations.linn;
  }

  response = self.radioNavigation;
  response.navigation.lists[0].items = [];
  for (var i in radioStation) {
    var channel = {
      service: self.serviceName,
      type: 'mywebradio',
      title: radioStation[i].title,
      artist: '',
      album: '',
      icon: 'fa fa-music',
      uri: radioStation[i].uri
    };
    response.navigation.lists[0].items.push(channel);
  }
  defer.resolve(response);

  return defer.promise;
};

ControllerPersonalRadio.prototype.clearAddPlayTrack = function(track) {
  var self = this;
  var defer = libQ.defer();

  return self.mpdPlugin.sendMpdCommand('stop', [])
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('clear', []);
    })
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('add "'+track.uri+'"',[]);
    })
    .then(function () {
      self.commandRouter.pushToastMessage('info',
        self.getRadioI18nString('PLUGIN_NAME'),
        self.getRadioI18nString('WAIT_FOR_RADIO_CHANNEL'));

      return self.mpdPlugin.sendMpdCommand('play', []).then(function () {
        switch (track.radioType) {
          case 'kbs':
          case 'sbs':
          case 'mbc':
            return self.mpdPlugin.getState().then(function (state) {
                return self.commandRouter.stateMachine.syncState(state, self.serviceName);
            });
            break;
          default:
            self.commandRouter.stateMachine.setConsumeUpdateService('mpd');
            return libQ.resolve();
        }
      })
    })
    .then(function () {
      if (track.radioType === 'kbs')
        self.timer = new RPTimer(self.setRadioMetaInfo.bind(self),
            [self.state.station, self.state.channel, self.state.programCode, self.state.metaUrl, true],
            self.state.remainingSeconds
        );
    })
    .fail(function (e) {
      return defer.reject(new Error());
    });
};

ControllerPersonalRadio.prototype.seek = function (position) {

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.stop = function() {
	var self = this;

  if (self.timer) {
    self.timer.clear();
  }

  self.commandRouter.pushToastMessage(
      'info',
      self.getRadioI18nString('PLUGIN_NAME'),
      self.getRadioI18nString('STOP_RADIO_CHANNEL')
  );
  return self.mpdPlugin.stop().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
          return self.commandRouter.stateMachine.syncState(state, self.serviceName);
      });
  });
};

ControllerPersonalRadio.prototype.pause = function() {
  var self = this;

  if (self.timer) {
    self.timer.clear();
  }

  return self.mpdPlugin.pause().then(function () {
    return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state, self.serviceName);
    });
  });
};

ControllerPersonalRadio.prototype.resume = function() {
  var self = this;

  return self.mpdPlugin.resume().then(function () {
    return self.mpdPlugin.getState().then(function (state) {

      self.commandRouter.stateMachine.syncState(state, self.serviceName);
      if (self.state.station === 'kbs') {
        self.setRadioMetaInfo(
          self.state.station,
          self.state.channel,
          self.state.programCode,
          self.state.metaUrl,
          true
        );
      }
    });
  });
};

ControllerPersonalRadio.prototype.pushState = function(state) {
  var self = this;

  return self.commandRouter.servicePushState(state, self.serviceName);
};

ControllerPersonalRadio.prototype.setRadioMetaInfo = function (station, channel, programCode, metaUrl, forceUpdate) {
  var self = this;

  self.getStreamUrl(station, self.baseKbsStreamUrl + metaUrl, "")
  .then(function (responseProgram) {
    var responseJson = JSON.parse(responseProgram);
    var activeProgram = responseJson.data[0]

    var vState = self.commandRouter.stateMachine.getState();
    var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
    vState.seek = 0;
    vState.disableUiControls = true;

    // checking program is changed
    if (!forceUpdate && activeProgram.program_code === programCode) {
      self.metaRetry.count ++;
      if (self.metaRetry.count > self.metaRetry.max) {
        vState.duration = 0;
        queueItem.duration = 0;
        self.metaRetry.count = 0;
        self.pushState(vState);
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
      var remainingSeconds = self.makeProgramFinishTime(activeProgram.end_time)
      vState.duration = remainingSeconds;
      queueItem.duration = remainingSeconds;
      self.commandRouter.stateMachine.currentSongDuration= remainingSeconds;
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

    self.commandRouter.stateMachine.currentSeek = 0;  // reset Volumio timer
    self.commandRouter.stateMachine.playbackStart=Date.now();
    self.commandRouter.stateMachine.askedForPrefetch=false;
    self.commandRouter.stateMachine.prefetchDone=false;
    self.commandRouter.stateMachine.simulateStopStartDone=false;

    self.pushState(vState);
  })
  .fail(function (error) {
    self.logger.error("[ControllerPersonalRadio::setRadioMetaInfo] Error")
  })
}

ControllerPersonalRadio.prototype.makeProgramFinishTime = function (endTime) {
  var remainingSeconds

  try {
    var endProgramHour = Number(endTime.substring(0, 2));
    var endProgramMinute = endTime.substring(2, 4);
    var nextDate;

    // get local time
    var zonedDate = utcToZonedTime(new Date(), 'Asia/Seoul');

    if (endProgramHour >= 24) {
      endProgramHour -= 24;
      var hours = dateGetHours(zonedDate)
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
  catch (ex) {
    self.logger.error("[ControllerPersonalRadio::makeProgramFinishTime] Error");
  }
  return remainingSeconds;
}

ControllerPersonalRadio.prototype.explodeUri = function (uri) {
  var self = this;
  var defer = libQ.defer();
  var uris = uri.split("/");
  var channel = parseInt(uris[1]);
  var response;
  var query;
  var station;

  station = uris[0].substring(3);
  response = {
      service: self.serviceName,
      type: 'track',
      trackType: self.getRadioI18nString('PLUGIN_NAME'),
      radioType: station,
      albumart: '/albumart?sourceicon=music_service/personal_radio/'+station+'.svg'
  };

  switch (uris[0]) {
    case 'webkbs':
      var radioChannel = self.radioStations.kbs[channel].channel;
      self.getStreamUrl(station, self.baseKbsTs, "")
      .then(function (reqTs) {
        var _0x5221=['from','replace','toUpperCase','base64','&reqts=','&authcode=','basekbsAgent','toString','baseKbsParam','baseKbsMeta'];
        (function(_0x5b4fc3,_0x52215e){
          var _0x39346b=function(_0x286639){while(--_0x286639){_0x5b4fc3['push'](_0x5b4fc3['shift']());}};_0x39346b(++_0x52215e);}(_0x5221,0x1e3));
          var _0x3934=function(_0x5b4fc3,_0x52215e){_0x5b4fc3=_0x5b4fc3-0x0;
          var _0x39346b=_0x5221[_0x5b4fc3];return _0x39346b;
        };
        var paramApi=self[_0x3934('0x5')]+radioChannel,metaApi=self[_0x3934('0x6')]+radioChannel,streamUrl=Buffer[_0x3934('0x7')]
        (paramApi+_0x3934('0x1')+reqTs+_0x3934('0x2')+cryptoJs(self[_0x3934('0x3')]+reqTs+paramApi)
            [_0x3934('0x4')]()['toUpperCase']())['toString'](_0x3934('0x0'))['replace'](/=/gi,''),metaUrl=Buffer[_0x3934('0x7')]
        (metaApi+_0x3934('0x1')+reqTs+'&authcode='+cryptoJs(self['basekbsAgent']+reqTs+metaApi)['toString']()[_0x3934('0x9')]())
            ['toString']('base64')[_0x3934('0x8')](/=/gi,'');

        self.getStreamUrl(station, self.baseKbsStreamUrl + streamUrl, "")
        .then(function (responseUrl) {
          try {
            if (responseUrl !== null) {
              response["uri"] = JSON.parse(responseUrl).real_service_url;
              response["name"] = self.radioStations.kbs[channel].title;
              response["title"] = self.radioStations.kbs[channel].title;
              response["disableUiControls"] = true;

              self.getStreamUrl(station, self.baseKbsStreamUrl + metaUrl, "")
              .then(function (responseProgram) {
                var responseJson = JSON.parse(responseProgram);
                var activeProgram = responseJson.data[0]

                if (activeProgram.end_time) {
                  var remainingSeconds = self.makeProgramFinishTime(activeProgram.end_time)
                  response["duration"] = remainingSeconds;
                  self.state = {
                    station: station,
                    channel: channel,
                    programCode: activeProgram.program_code,
                    remainingSeconds: remainingSeconds,
                    metaUrl: metaUrl
                  }
                }
                if (activeProgram.program_title)
                  response["name"] = response["name"] + "("
                      + activeProgram.program_title + ")"
                if (activeProgram.relation_image)
                  response.albumart = activeProgram.relation_image
                defer.resolve(response);
              })
              .fail(function (error) {
                self.logger.error("[ControllerPersonalRadio:explodeUri] KBS meta data error");
                defer.resolve(response);
              })
            }
          }
          catch (ex) {
            self.logger.error("[ControllerPersonalRadio::KBS explodeUri] KBS stream error");
          }
        });
      });
      break;

    case 'websbs':
      var device;
      if(self.sbsProtocol === true)
        device = 'mobile';
      else
        device = 'pc';

      var baseSbsStreamUrl = self.baseSbsStreamUrl + self.radioStations.sbs[channel].channel;
      self.getStreamUrl(station, baseSbsStreamUrl, {device: device})
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            var decipher = crypto.createDecipheriv(self.sbsAlgorithm, self.sbsKey, "");
            var streamUrl = decipher.update(responseUrl, 'base64', 'utf8');
            streamUrl += decipher.final('utf8');

            response["uri"] = streamUrl;
            response["name"] = self.radioStations.sbs[channel].title;
            response["title"] = self.radioStations.sbs[channel].title;
          }
          self.state = {
            station: station
          }
          defer.resolve(response);
        });
      break;

    case 'webmbc':
      var agent, protocol;
      if(self.mbcProtocol === true) {
        agent = 'android';
        protocol = 'M3U8';
      }
      else {
        agent = 'pc';
        protocol = 'RTMP';
      }

      query = {
        channel: self.radioStations.mbc[channel].channel,
        agent: agent,
        protocol: protocol
      };
      self.getStreamUrl(station, self.baseMbcStreamUrl, query)
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            response["uri"] = responseUrl;
            response["name"] = self.radioStations.mbc[channel].title;
            response["title"] = self.radioStations.mbc[channel].title;
          }
          self.state = {
            station: station
          }
          defer.resolve(response);
        });
      break;

    case 'weblinn':
      response["uri"] = self.radioStations.linn[channel].url;
      response["name"] = self.radioStations.linn[channel].title;
      self.state = {
        station: station
      }
      defer.resolve(response);
      break;

    default:
      defer.resolve();
  }

  return defer.promise;
};

// Stream and resource functions for Radio -----------------------------------

ControllerPersonalRadio.prototype.getSecretKey = function (radioKeyUrl) {
  var self = this;
  var defer = libQ.defer();

  var Request = unirest.get(radioKeyUrl);
  Request.end (function (response) {
    if (response.status === 200) {
      var result = JSON.parse(response.body);

      if (result !== undefined) {
        defer.resolve(result);
      } else {
        self.commandRouter.pushToastMessage('error',
            self.getRadioI18nString('PLUGIN_NAME'),
            self.getRadioI18nString('ERROR_SECRET_KEY'));

        defer.resolve(null);
      }
    } else {
      self.commandRouter.pushToastMessage('error',
          self.getRadioI18nString('PLUGIN_NAME'),
          self.getRadioI18nString('ERROR_SECRET_KEY_SERVER'));
      defer.resolve(null);
    }
  });

  return defer.promise;
};

ControllerPersonalRadio.prototype.getStreamUrl = function (station, url, query) {
  var self = this;
  var defer = libQ.defer();

  var Request = unirest.get(url);
  Request
    .query(query)
    .end(function (response) {
      if (response.status === 200)
        defer.resolve(response.body);
      else {
        defer.resolve(null);
        self.errorToast(station, 'ERROR_STREAM_SERVER');
      }
    });

  return defer.promise;
};

ControllerPersonalRadio.prototype.addRadioResource = function() {
  var self=this;

  var radioResource = fs.readJsonSync(__dirname+'/radio_stations.json');
  var baseNavigation = radioResource.baseNavigation;

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
  self.getSecretKey(radioResource.encodedRadio.radioKeyUrl).then(function(response) {
    var secretKey = response.secretKey;
    var algorithm = response.algorithm;
    self.sbsKey = (new Buffer(response.stationKey, 'base64')).toString('ascii');
    self.sbsAlgorithm = response.algorithm2;

    self.baseKbsStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbs);
    self.baseMbcStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.mbc);
    self.baseSbsStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.sbs);

    self.basekbsAgent = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsAgent);
    self.baseKbsTs = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsTs);
    self.baseKbsParam = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsParam);
    self.baseKbsMeta = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbsMeta);
    self.baseKbsStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbs);
    self.baseMbcStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.mbc);
    self.baseSbsStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.sbs);
  });
};

ControllerPersonalRadio.prototype.loadRadioI18nStrings = function () {
  var self=this;

  try {
    var language_code = this.commandRouter.sharedVars.get('language_code');
    self.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_'+language_code+".json");
  } catch(e) {
    self.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
  }

  self.i18nStringsDefaults=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
};

ControllerPersonalRadio.prototype.getRadioI18nString = function (key) {
  var self=this;

  if (self.i18nStrings[key] !== undefined)
    return self.i18nStrings[key];
  else
    return self.i18nStringsDefaults[key];
};

ControllerPersonalRadio.prototype.decodeStreamUrl =
    function (algorithm, secretKey, encodedUri) {

  var decipherObj = crypto.createDecipher(algorithm, secretKey);
  var streamUrl = decipherObj.update(encodedUri, 'hex', 'utf8');
  streamUrl += decipherObj.final('utf8');

  return streamUrl;
};

ControllerPersonalRadio.prototype.errorToast = function (station, msg) {
  var errorMessage = self.getRadioI18nString(msg);
  errorMessage.replace('{0}', station.toUpperCase());
  self.commandRouter.pushToastMessage('error',
      self.getRadioI18nString('PLUGIN_NAME'), errorMessage);
};

function RPTimer(callback, args, delay) {
  var remaining = delay;

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
