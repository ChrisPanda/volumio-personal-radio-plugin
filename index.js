'use strict';

// This Volumio plugin provides Korean radios (SBS, KBS, MBC) and Linn radio.
const path = require('path');
global.personalRadioRoot = path.resolve(__dirname);

const libQ = require('kew');
const fs = require('fs-extra');
const config = require('v-conf');
const radioCore = require(personalRadioRoot + '/radio-core');
const radioBrowserUi = require(personalRadioRoot + '/radio-browser-ui');
const radioProgram = require(personalRadioRoot + '/radio-program');

module.exports = ControllerPersonalRadio;

function ControllerPersonalRadio(context) {
  this.context = context;
  this.commandRouter = this.context.coreCommand;
  this.logger = this.context.logger;
  this.configManager = this.context.configManager;
  this.stateMachine = this.commandRouter.stateMachine;

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
  self.radioProgram = new radioProgram()
  self.radioProgram.init(this)

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

        switch (track.station) {
          case 'kbs':
          case 'sbs':
          case 'mbc':
            return self.mpdPlugin.getState().then(function (state) {
              if (state && track.station !== 'sbs') {
                var vState = self.commandRouter.stateMachine.getState();
                var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];
                queueItem.name = track.name + " (" + track.programTitle + ")";
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
      self.radioProgram.startRadioProgram(track)
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

  self.radioProgram.clearRadioProgram();

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

  self.radioProgram.clearRadioProgram();

  return self.mpdPlugin.pause().then(function () {
    return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state, self.serviceName);
    });
  });
};

ControllerPersonalRadio.prototype.resume = function() {
  var self = this;

  var trackinfo=self.commandRouter.stateMachine.getTrack(self.commandRouter.stateMachine.currentPosition);

  return self.mpdPlugin.resume().then(function () {
    return self.mpdPlugin.getState().then(function (state) {

      self.commandRouter.stateMachine.syncState(state, self.serviceName);
      if (trackinfo.station === 'kbs') {
        self.radioProgram.setKbsRadioProgram(
            trackinfo.station,
            trackinfo.channel,
            trackinfo.programCode,
            trackinfo.metaUrl,
            true);
      }
      else if (trackinfo.station === 'mbc') {
        self.radioProgram.setMbcRadioProgram(
            trackinfo.station,
            trackinfo.channel,
            true
        )
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
  var station;

  // radio_station/channel
  station = uris[0].substring(3);
  response = {
      service: self.serviceName,
      type: 'track',
      trackType: self.radioCore.getRadioI18nString('PLUGIN_NAME'),
      station: station,
      channel: channel,
      albumart: '/albumart?sourceicon=music_service/personal_radio/logos/'+station+channel+'.png'
  };

  switch (uris[0]) {
    case 'webkbs':
      self.radioCore.kbsExplodeUri(station, channel, uri, response)
          .then(function(result) {
            responseResult.push(result)
            defer.resolve(responseResult);
          })
      break;

    case 'websbs':
      self.radioCore.sbsExplodeUri(station, channel, uri, response)
      .then(function(result) {
          responseResult.push(result)
          defer.resolve(responseResult);
      })
      break;

    case 'webmbc':
      self.radioCore.mbcExplodeUri(station, channel, uri, response)
          .then(function(result) {
            responseResult.push(result)
            defer.resolve(responseResult);
          })
      break;

    case 'weblinn':
      response["uri"] = uri;
      response["realUri"] = self.radioCore.radioStations.linn[channel].url;
      response["name"] = self.radioCore.radioStations.linn[channel].title;

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

  const station = channelName.substring(0, 3);
  if (station === "KBS")
    self.radioProgram.getKbsRadioSchedule(radioChannel, channelName)
  else if (station === "MBC")
    self.radioProgram.getMbcRadioSchedule(radioChannel, channelName)
}