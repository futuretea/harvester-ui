import https from 'https';
import cloneDeep from 'lodash/cloneDeep';
import merge from 'lodash/merge';
import { SCHEMA } from '@/config/types';
import { addPrefix, addParam } from '@/utils/url';
import { createYaml } from '@/utils/create-yaml';
import { SPOOFED_API_PREFIX, SPOOFED_PREFIX } from '@/store/type-map';

import Notification from '@/components/Notification/main.js';
import { normalizeType } from './normalize';
import { proxyFor, SELF } from './resource-proxy';

export default {
  async request({ dispatch, rootGetters }, opt) {
    // Handle spoofed types instead of making an actual request
    // Spoofing is handled here to ensure it's done for both yaml and form editing.
    // It became apparent that this was the only place that both intersected
    if (opt.url.includes(SPOOFED_PREFIX) || opt.url.includes(SPOOFED_API_PREFIX)) {
      const [empty, scheme, type, ...rest] = opt.url.split('/'); // eslint-disable-line no-unused-vars
      const id = rest.join('/'); // Cover case where id contains '/'
      const isApi = scheme === SPOOFED_API_PREFIX;
      const typemapGetter = id ? 'getSpoofedInstance' : 'getSpoofedInstances';
      const schemas = await rootGetters['cluster/all'](SCHEMA);
      const instance = await rootGetters[`type-map/${ typemapGetter }`](type, id);
      const data = isApi ? createYaml(schemas, type, instance) : instance;

      return id && !isApi ? data : { data };
    }

    // @TODO queue/defer duplicate requests
    opt.depaginate = opt.depaginate !== false;
    opt.url = opt.url?.replace(/\/*$/g, '');
    opt.url = addPrefix(opt.url); // rancher proxy

    opt.httpsAgent = new https.Agent({ rejectUnauthorized: false });

    return this.$axios(opt).then((res) => {
      if ( opt.depaginate ) {
        // @TODO but API never sends it
        /*
        return new Promise((resolve, reject) => {
          const next = res.pagination.next;
          if (!next ) [
            return resolve();
          }

          dispatch('request')
        });
        */
      }

      if ( opt.responseType ) {
        return res;
      } else {
        return responseObject(res);
      }
    }).catch((err) => {
      if ( !err || !err.response ) {
        return Promise.reject(err);
      }

      const res = err.response;

      // Go to the logout page for 401s, unless redirectUnauthorized specifically disables (for the login page)
      if ( opt.redirectUnauthorized !== false && process.client && res.status === 401 ) {
        dispatch('auth/logout', opt.logoutOnError, { root: true });
      }

      if ( typeof res.data !== 'undefined' ) {
        return Promise.reject(responseObject(res));
      }

      return Promise.reject(err);
    });

    function responseObject(res) {
      let out = res.data;

      if ( typeof out !== 'object' ) {
        out = { data: out };
      }

      Object.defineProperties(out, {
        _status:     { value: res.status },
        _statusText: { value: res.statusText },
        _headers:    { value: res.headers },
        _req:        { value: res.request },
        _url:        { value: opt.url },
      });

      return out;
    }
  },

  async loadSchemas(ctx, watch = true) {
    const {
      getters, dispatch, commit, rootGetters
    } = ctx;
    const res = await dispatch('findAll', {
      type: SCHEMA,
      opt:  {
        url: 'schemas', load: false, force: true
      }
    });
    const spoofedTypes = rootGetters['type-map/allSpoofedSchemas'] ;

    res.data = res.data.concat(spoofedTypes);

    res.data.forEach((schema) => {
      schema._id = normalizeType(schema.id);
      schema._group = normalizeType(schema.attributes?.group);
    });

    commit('loadAll', {
      ctx,
      type: SCHEMA,
      data: res.data
    });

    if ( watch !== false ) {
      dispatch('watch', {
        type:     SCHEMA,
        revision: res.revision
      });
    }

    const all = getters.all(SCHEMA);

    return all;
  },

  async findAll(ctx, { type, opt }) {
    const { getters, commit, dispatch } = ctx;

    opt = opt || {};
    type = getters.normalizeType(type);

    if ( !getters.typeRegistered(type) ) {
      commit('registerType', type);
    }

    if ( opt.force !== true && getters['haveAll'](type) ) {
      return getters.all(type);
    }

    console.log(`Find All: [${ ctx.state.config.namespace }] ${ type }`); // eslint-disable-line no-console
    opt = opt || {};
    opt.url = getters.urlFor(type, null, opt);

    const res = await dispatch('request', opt);

    if ( opt.load === false ) {
      return res;
    }

    commit('loadAll', {
      ctx,
      type,
      data: res.data
    });

    if ( opt.watch !== false ) {
      dispatch('watch', {
        type,
        revision:  res.revision,
        namespace: opt.watchNamespace
      });
    }

    const all = getters.all(type);

    return all;
  },

  async findMatching(ctx, { type, selector, opt }) {
    const { getters, commit, dispatch } = ctx;

    opt = opt || {};
    console.log(`Find Matching: [${ ctx.state.config.namespace }] ${ type }`, selector); // eslint-disable-line no-console
    type = getters.normalizeType(type);

    if ( !getters.typeRegistered(type) ) {
      commit('registerType', type);
    }
    if ( opt.force !== true && getters['haveSelector'](type, selector) ) {
      return getters.matching( type, selector );
    }

    opt = opt || {};

    opt.filter = opt.filter || {};
    opt.filter['labelSelector'] = selector;

    opt.url = getters.urlFor(type, null, opt);

    const res = await dispatch('request', opt);

    if ( opt.load === false ) {
      return res.data;
    }

    commit('loadSelector', {
      ctx,
      type,
      entries: res.data,
      selector
    });

    if ( opt.watch !== false ) {
      dispatch('watch', {
        type,
        selector,
        revision: res.revision
      });
    }

    return getters.matching( type, selector );
  },

  // opt:
  //  filter: Filter by fields, e.g. {field: value, anotherField: anotherValue} (default: none)
  //  limit: Number of reqords to return per page (default: 1000)
  //  sortBy: Sort by field
  //  sortOrder: asc or desc
  //  url: Use this specific URL instead of looking up the URL for the type/id.  This should only be used for bootstraping schemas on startup.
  //  @TODO depaginate: If the response is paginated, retrieve all the pages. (default: true)
  async find(ctx, { type, id, opt }) {
    const { getters, dispatch } = ctx;

    opt = opt || {};

    type = normalizeType(type);

    console.log(`Find: [${ ctx.state.config.namespace }] ${ type } ${ id }`); // eslint-disable-line no-console
    let out;

    if ( opt.force !== true ) {
      out = getters.byId(type, id);

      if ( out ) {
        return out;
      }
    }

    opt = opt || {};
    opt.url = getters.urlFor(type, id, opt);

    const res = await dispatch('request', opt);

    await dispatch('load', { data: res });

    if ( opt.watch !== false ) {
      const watchMsg = {
        type,
        id,
        revision: res?.metadata?.resourceVersion,
        force:    opt.forceWatch === true,
      };

      const idx = id.indexOf('/');

      if ( idx > 0 ) {
        watchMsg.namespace = id.substr(0, idx);
        watchMsg.id = id.substr(idx + 1);
      }

      dispatch('watch', watchMsg);
    }

    out = getters.byId(type, id);

    return out;
  },

  load(ctx, { data, existing }) {
    const { getters, commit } = ctx;

    let type = normalizeType(data.type);

    if ( !getters.typeRegistered(type) ) {
      commit('registerType', type);
    }

    if ( data.baseType && data.baseType !== data.type ) {
      type = normalizeType(data.baseType);

      if ( !getters.typeRegistered(type) ) {
        commit('registerType', type);
      }
    }

    const id = data?.id || existing?.id;

    if ( !id ) {
      console.warn('Attempting to load a resource with no id', data, existing); // eslint-disable-line no-console

      return;
    }

    commit('load', {
      ctx,
      data,
      existing
    });

    if ( type === SCHEMA ) {
      commit('type-map/schemaChanged', null, { root: true });
    }

    return getters['byId'](type, id);
  },

  loadMulti(ctx, entries) {
    const { commit } = ctx;

    commit('loadMulti', {
      entries,
      ctx,
    });
  },

  loadAll(ctx, { type, data }) {
    const { commit } = ctx;

    commit('loadAll', {
      ctx,
      type,
      data
    });
  },

  setConfig(ctx, { type, data }) {
    const { commit } = ctx;

    commit('setConfig', {
      ctx,
      type,
      data
    });
  },

  create(ctx, data) {
    return proxyFor(ctx, data);
  },

  createPopulated(ctx, userData) {
    const data = ctx.getters['defaultFor'](userData.type);

    merge(data, userData);

    return proxyFor(ctx, data);
  },

  clone(ctx, { resource } = {}) {
    const copy = cloneDeep(resource[SELF]);

    return proxyFor(ctx, copy, true);
  },

  promptRemove({ commit, state }, resources ) {
    commit('action-menu/togglePromptRemove', resources, { root: true });
  },

  assignTo({ commit, state }, resources = []) {
    commit('action-menu/toggleAssignTo', resources, { root: true });
  },

  ejectCDROM({ commit, state }, resources = []) {
    commit('action-menu/toggleEjectCDROM', resources, { root: true });
  },

  async resourceAction({ getters, rootGetters, dispatch }, {
    resource, actionName, body, opt, showNotify = true
  }) {
    opt = opt || {};

    if ( !opt.url ) {
      opt.url = resource.actionLinkFor(actionName);
      // opt.url = (resource.actions || resource.actionLinks)[actionName];
    }

    opt.method = 'post';
    opt.data = body;

    let res = {};

    try {
      res = await dispatch('request', opt);
    } catch (e) {
      res = e;
      const t = rootGetters['i18n/t'];
      let message = t('generic.unknownErrorTip');

      if (e && e.data) {
        message = e.data;
      } else if (e && e.message) {
        message = e.message;
      }

      if (showNotify) {
        Notification.error(message);
      }
    }

    if ( opt.load !== false && res.type === 'collection' ) {
      await dispatch('loadMulti', res.data);

      return res.data.map(x => getters.byId(x.type, x.id) || x);
    } else if ( opt.load !== false && res.type && res.id ) {
      return dispatch('load', { data: res });
    } else {
      return res;
    }
  },

  promptUpdate({ commit, state }, resources = []) {
    commit('action-menu/togglePromptUpdate', resources, { root: true });
  },

  async collectionAction({ getters, dispatch }, {
    type, actionName, body, opt
  }) {
    opt = opt || {};

    if ( !opt.url ) {
      // Cheating, but cheaper than loading the whole collection...
      const schema = getters['schemaFor'](type);

      opt.url = addParam(schema.links.collection, 'action', actionName);
    }

    opt.method = 'post';
    opt.data = body;

    const res = await dispatch('request', opt);

    if ( opt.load !== false && res.type === 'collection' ) {
      await dispatch('loadMulti', res.data);

      return res.data.map(x => getters.byId(x.type, x.id) || x);
    } else if ( opt.load !== false && res.type && res.id ) {
      return dispatch('load', { data: res });
    } else {
      return res;
    }
  },
};
