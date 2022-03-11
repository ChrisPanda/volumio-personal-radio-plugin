'use strict';

// This Volumio plugin provides Korean radios (SBS, KBS, MBC) and Linn radio.
const path = require('path');
global.personalRadioRoot = path.resolve(__dirname);

const libQ = require('kew');
const fs = require('fs-extra');
const config = require('v-conf');
const crypto = require('crypto');
const cryptoJs = require('crypto-js/sha256');
const radioCore = require(personalRadioRoot + '/radio-core');
const radioBrowserUi = require(personalRadioRoot + '/radio-browser-ui');

module.exports = ControllerPersonalRadio;

function ControllerPersonalRadio(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  this.stateMachine = self.commandRouter.stateMachine;

  this.logger.info("ControllerPersonalRadio::constructor");
}

ControllerPersonalRadio.prototype.onVolumioStart = function()
{
  var self = this;

  self.configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
  self.getConf(self.configFile);

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerPersonalRadio.prototype.onStart = function() {
  var self = this;

  self.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service','mpd');

  self.radioCore = new radioCore()
  self.radioCore.init(this)
  self.radioBrowserUi = new radioBrowserUi()
  self.radioBrowserUi.init(this)
  self.serviceName = "personal_radio";
  self.addToBrowseSources();

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onStop = function() {

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onRestart = function() {

  return libQ.resolve();
};


// Configuration Methods -----------------------------------------------------
ControllerPersonalRadio.prototype.getConf = function(configFile) {
  var self = this;

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
};

ControllerPersonalRadio.prototype.setConf = function(conf) {

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

// Playback Controls ---------------------------------------------------------
ControllerPersonalRadio.prototype.addToBrowseSources = function () {
  var self = this;

  self.commandRouter.volumioAddToBrowseSources({
    name: self.radioCore.getRadioI18nString('PLUGIN_NAME'),
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
      response = self.radioBrowserUi.getRootContent();
    }
    else if (curUri === 'kradio/kbs') {
      response = self.radioBrowserUi.getRadioContent('kbs');
    }
    else if (curUri === 'kradio/sbs') {
        response = self.radioBrowserUi.getRadioContent('sbs');
    }
    else if (curUri === 'kradio/mbc') {
      response = self.radioBrowserUi.getRadioContent('mbc');
    }
    else if (curUri === 'kradio/linn') {
      response = self.radioBrowserUi.getRadioContent('linn');
    }
    else {
      response = libQ.reject();
    }
  }

  return response
    .fail(function (e) {
      self.logger.info('ControllerPersonalRadio:handleBrowseUri failed=', e);
      libQ.reject(new Error());
    });
};

ControllerPersonalRadio.prototype.clearAddPlayTrack = function(track) {
  var self = this;
  var defer = libQ.defer();

  return self.mpdPlugin.sendMpdCommand('stop', [])
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('clear', []);
    })
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('add "'+track.realUri+'"',[]);
    })
    .then(function () {
      self.commandRouter.pushToastMessage('info',
        self.radioCore.getRadioI18nString('PLUGIN_NAME'),
        self.radioCore.getRadioI18nString('WAIT_FOR_RADIO_CHANNEL'));

      return self.mpdPlugin.sendMpdCommand('play', []).then(function () {
        self.commandRouter.checkFavourites({uri: track.uri}).then(function(favouriteStatus) {
          self.commandRouter.emitFavourites(
              {service: self.serviceName, uri: track.uri, favourite: favouriteStatus.favourite}
          );
        })

        switch (track.radioType) {
          case 'kbs':
          case 'sbs':
          case 'mbc':
            return self.mpdPlugin.getState().then(function (state) {
              if (state && track.radioType === 'kbs') {
                var vState = self.commandRouter.stateMachine.getState();
                var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
                queueItem.name = track.name + " (" + track.program + ")";
              }
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
      if (track.radioType === 'kbs') self.radioCore.resetRPTimer()
    })
    .fail(function (e) {
      self.logger.error("[ControllerPersonalRadio::clearAddPlayTrack] Error=", e)
      return defer.reject(new Error());
    });
};

ControllerPersonalRadio.prototype.seek = function (position) {

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.stop = function() {
  var self = this;

  if (self.radioCore.timer) {
    self.radioCore.timer.clear();
  }

  self.commandRouter.pushToastMessage(
      'info',
      self.radioCore.getRadioI18nString('PLUGIN_NAME'),
      self.radioCore.getRadioI18nString('STOP_RADIO_CHANNEL')
  );
  return self.mpdPlugin.stop().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
          return self.commandRouter.stateMachine.syncState(state, self.serviceName);
      });
  });
};

ControllerPersonalRadio.prototype.pause = function() {
  var self = this;

  if (self.radioCore.timer) {
    self.radioCore.timer.clear();
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
      if (self.radioCore.state.station === 'kbs') {
        self.radioCore.setRadioMetaInfo(
          self.radioCore.state.station,
          self.radioCore.state.channel,
          self.radioCore.state.programCode,
          self.radioCore.state.metaUrl,
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

ControllerPersonalRadio.prototype.explodeUri = function (uri) {
  var self = this;
  var defer = libQ.defer();
  var uris = uri.split("/");
  var channel = parseInt(uris[1]);
  var response, responseResult=[];
  var query;
  var station;

  // radio_station/channel
  station = uris[0].substring(3);
  response = {
      service: self.serviceName,
      type: 'track',
      trackType: self.radioCore.getRadioI18nString('PLUGIN_NAME'),
      radioType: station,
      albumart: '/albumart?sourceicon=music_service/personal_radio/logos/'+station+channel+'.png'
  };

  switch (uris[0]) {
    case 'webkbs':
      var radioChannel = self.radioCore.radioStations.kbs[channel].channel;
      self.radioCore.fetchRadioUrl(station, self.radioCore.kbsInfo.kbsTs, "")
      .then(function (reqTs) {
        var _0x5948f1=_0x573c;(function(_0x337c35,_0x1647c2)
        {var _0x578434=_0x573c,_0xb7d97e=_0x337c35();while(!![]){
          try{
            var _0xd03493=parseInt(_0x578434(0xc2))/0x1+-parseInt(_0x578434(0xbf))/0x2*(
                parseInt(_0x578434(0xc3))/0x3)+parseInt(_0x578434(0xbe))/0x4+-
                parseInt(_0x578434(0xb9))/0x5+-parseInt(_0x578434(0xbc))/0x6+-
                parseInt(_0x578434(0xc1))/0x7+parseInt(_0x578434(0xba))/0x8;
            if(_0xd03493===_0x1647c2)break;else _0xb7d97e['push'](_0xb7d97e['shift']());
          }catch(_0x770f7f){_0xb7d97e['push'](_0xb7d97e['shift']());}}}(_0x55f1,0xacb8b));
        function _0x573c(_0x469cdd,_0x361d45){var _0x55f196=_0x55f1();
          return _0x573c=function(_0x573c2a,_0x3570f5){_0x573c2a=_0x573c2a-0xb8;var _0x1a03b8=_0x55f196[_0x573c2a];
            return _0x1a03b8;
            },_0x573c(_0x469cdd,_0x361d45);}
        var paramApi=self['kbsInfo']['kbsParam']+radioChannel,metaApi=self['kbsInfo'][_0x5948f1(0xc0)]+
            radioChannel,streamUrl=Buffer['from'](paramApi+_0x5948f1(0xb8)+reqTs+'&authcode='+
            cryptoJs(self['kbsInfo'][_0x5948f1(0xbb)]+reqTs+paramApi)['toString']()
                ['toUpperCase']())['toString']('base64')[_0x5948f1(0xbd)](/=/gi,''),
            metaUrl=Buffer['from'](metaApi+'&reqts='+reqTs+'&authcode='+cryptoJs(self['kbsInfo']
                [_0x5948f1(0xbb)]+reqTs+metaApi)['toString']()['toUpperCase']())['toString']
            ('base64')['replace'](/=/gi,'');function _0x55f1(){
              var _0x5bcac8=['6EuXCsA','kbsMeta','9265704YxbPzF','1183080aXmflk','923823AauTSZ',
                '&reqts=','6237445KYvNDB','33050336LWjkGF','kbsAgent','7657056qfEUEJ','replace','657020MxYjbG'];
              _0x55f1=function(){return _0x5bcac8;};return _0x55f1();
            }

        self.radioCore.fetchRadioUrl(station, self.radioCore.baseKbsStreamUrl + streamUrl, "")
        .then(function (responseUrl) {
          try {
            if (responseUrl !== null) {
              response["uri"] = uri;
              response["realUri"] = JSON.parse(responseUrl).real_service_url;
              response["name"] = self.radioCore.radioStations.kbs[channel].title;
              response["disableUiControls"] = true;

              self.radioCore.fetchRadioUrl(station, self.radioCore.baseKbsStreamUrl + metaUrl, "")
              .then(function (responseProgram) {
                var responseJson = JSON.parse(responseProgram);
                var activeProgram = responseJson.data[0]

                if (activeProgram.end_time) {
                  var remainingSeconds = self.radioCore.makeProgramFinishTime(activeProgram.end_time)
                  response["duration"] = remainingSeconds;
                  self.radioCore.state = {
                    station: station,
                    channel: channel,
                    programCode: activeProgram.program_code,
                    remainingSeconds: remainingSeconds,
                    metaUrl: metaUrl
                  }
                }
                if (activeProgram.program_title)
                  response["program"] = activeProgram.program_title
                if (activeProgram.relation_image)
                  response.albumart = activeProgram.relation_image;
                responseResult.push(response);
                defer.resolve(responseResult);
              })
              .fail(function (error) {
                self.logger.error("[ControllerPersonalRadio:explodeUri] KBS meta data error=", error);
                responseResult.push(response);
                defer.resolve(responseResult);
              })
            }
          }
          catch (error) {
            self.logger.error("[ControllerPersonalRadio::KBS explodeUri] KBS stream error=", error);
          }
        });
      });
      break;

    case 'websbs':
      var baseSbsStreamUrl = self.radioCore.baseSbsStreamUrl + self.radioCore.radioStations.sbs[channel].channel;
      self.radioCore.fetchRadioUrl(station, baseSbsStreamUrl, {device: "mobile"})
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            var decipher = crypto.createDecipheriv(self.radioCore.sbsInfo.sbsAlgorithm, self.radioCore.sbsInfo.sbsKey, "");
            var streamUrl = decipher.update(responseUrl, 'base64', 'utf8');
            streamUrl += decipher.final('utf8');

            response["uri"] = uri;
            response["realUri"] = streamUrl;
            response["name"] = self.radioCore.radioStations.sbs[channel].title;
          }
          self.radioCore.state = {
            station: station
          }
          responseResult.push(response);
          defer.resolve(responseResult);
        });
      break;

    case 'webmbc':
      query = {
        channel: self.radioCore.radioStations.mbc[channel].channel,
        agent: "webapp",
        protocol: "M3U8",
        nocash: Math.random()
      };
      self.radioCore.fetchRadioUrl(station, self.radioCore.baseMbcStreamUrl, query)
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            response["uri"] = uri;
            response["realUri"] = responseUrl;
            response["name"] = self.radioCore.radioStations.mbc[channel].title;
          }
          self.radioCore.state = {
            station: station
          }
          responseResult.push(response);
          defer.resolve(responseResult);
        });
      break;

    case 'weblinn':
      response["uri"] = uri;
      response["realUri"] = self.radioCore.radioStations.linn[channel].url;
      response["name"] = self.radioCore.radioStations.linn[channel].title;
      self.radioCore.state = {
        station: station
      }
      responseResult.push(response);
      defer.resolve(responseResult);
      break;

    default:
      responseResult.push(response);
      defer.resolve(responseResult);
  }

  return defer.promise;
};

ControllerPersonalRadio.prototype.showRadioProgram = function(data) {
  var self = this;

  let radioChannel = data['radio_channel'].value;
  let channelName = data['radio_channel'].label;

  self.radioCore.getRadioProgram(radioChannel, channelName)
}