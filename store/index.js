/* eslint-disable */
import Steve from '@/plugins/steve';
import {
  COUNT, NAMESPACE, NORMAN, EXTERNAL, MANAGEMENT, STEVE, IMAGE, VM_TEMPLATE, SSH, DATA_VOLUME, VM, VMIM, FLEET, POD, HARVESTER_SETTING, NODE, HARVESTER_RESTORE, NETWORK_ATTACHMENT
} from '@/config/types';
import { CLUSTER as CLUSTER_PREF, NAMESPACE_FILTERS, LAST_NAMESPACE, WORKSPACE } from '@/store/prefs';
import { allSettled } from '@/utils/promise';
import { ClusterNotFoundError, ApiError } from '@/utils/error';
import { sortBy } from '@/utils/sort';
import { filterBy, findBy } from '@/utils/array';
import { BOTH, CLUSTER_LEVEL, NAMESPACED } from '@/store/type-map';
import { NAME as EXPLORER } from '@/config/product/explorer';
import { TIMED_OUT, LOGGED_OUT } from '@/config/query-params';

// Disables strict mode for all store instances to prevent warning about changing state outside of mutations
// becaues it's more efficient to do that sometimes.
export const strict = false;

export const plugins = [
  Steve({ namespace: 'clusterExternal', baseUrl: '' }), // project scoped cluster stuff, url set later
  Steve({ namespace: 'management', baseUrl: '/v1' }),
  Steve({ namespace: 'cluster', baseUrl: '' }), // url set later
  Steve({ namespace: 'rancher', baseUrl: '/v3' }),
];

export const state = () => {
  return {
    managementReady:  false,
    clusterReady:     false,
    isMultiCluster:   false,
    isRancher:        false,
    namespaceFilters: [],
    allNamespaces:    null,
    allWorkspaces:    null,
    clusterId:        null,
    productId:        null,
    workspace:        null,
    error:            null,
    cameFromError:    false,
  };
};

export const getters = {
  clusterReady(state) {
    return state.clusterReady === true;
  },

  isMultiCluster(state) {
    return state.isMultiCluster === true;
  },

  isRancher(state) {
    return state.isRancher === true;
  },

  clusterId(state) {
    return state.clusterId;
  },

  productId(state, getters) {
    return state.productId;
  },

  workspace(state, getters) {
    return state.workspace;
  },

  currentCluster(state, getters) {
    return getters['management/byId'](MANAGEMENT.CLUSTER, state.clusterId);
  },

  currentProduct(state, getters) {
    const active = getters['type-map/activeProducts'];

    let out = findBy(active, 'name', state.productId);

    if ( !out ) {
      out = findBy(active, 'name', EXPLORER);
    }

    if ( !out ) {
      out = active[0];
    }

    return out;
  },

  isExplorer(state, getters) {
    const product = getters.currentProduct;

    if ( !product ) {
      return false;
    }

    return product.name === EXPLORER || product.inStore === 'cluster';
  },

  defaultClusterId(state, getters) {
    // const all = getters['management/all'](MANAGEMENT.CLUSTER);
    // const clusters = sortBy(filterBy(all, 'isReady'), 'nameDisplay');
    // const desired = getters['prefs/get'](CLUSTER_PREF);

    // if ( clusters.find(x => x.id === desired) ) {
    //   return desired;
    // } else if ( clusters.length ) {
    //   return clusters[0].id;
    // }

    // return null;
    return 'local';
  },

  isAllNamespaces(state, getters) {
    const product = getters['currentProduct'];

    if ( !product ) {
      return true;
    }

    if ( product.showWorkspaceSwitcher ) {
      return false;
    }

    if ( !product.showNamespaceFilter ) {
      return true;
    }

    return state.namespaceFilters.filter(x => !`${ x }`.startsWith('namespaced://')).length === 0;
  },

  isMultipleNamespaces(state, getters) {
    const product = getters['currentProduct'];

    if ( !product ) {
      return true;
    }

    if ( product.showWorkspaceSwitcher ) {
      return false;
    }

    if ( getters.isAllNamespaces ) {
      return true;
    }

    const filters = state.namespaceFilters;

    if ( filters.length !== 1 ) {
      return true;
    }

    return !filters[0].startsWith('ns://');
  },

  namespaceMode(state, getters) {
    const filters = state.namespaceFilters;
    const product = getters['currentProduct'];

    if ( !product?.showNamespaceFilter ) {
      return BOTH;
    }

    // Explicitly asking
    if ( filters.includes('namespaced://true') ) {
      return NAMESPACED;
    } else if ( filters.includes('namespaced://false') ) {
      return CLUSTER_LEVEL;
    }

    const byKind = {};

    for ( const filter of filters ) {
      const type = filter.split('://', 2)[0];

      byKind[type] = (byKind[type] || 0) + 1;
    }

    if ( byKind['project'] > 0 || byKind['ns'] > 0 ) {
      return NAMESPACED;
    }

    return BOTH;
  },

  namespaces(state, getters) {
    return () => {
      const out = {};
      const product = getters['currentProduct'];
      const workspace = state.workspace;

      if ( !product ) {
        return out;
      }

      if ( product.showWorkspaceSwitcher ) {
        return { [workspace]: true };
      }

      const inStore = product?.inStore;
      const clusterId = getters['currentCluster']?.id;

      if ( !clusterId || !inStore ) {
        return out;
      }

      const namespaces = getters[`${ inStore }/all`](NAMESPACE);
      const filters = state.namespaceFilters.filter(x => !!x && !`${ x }`.startsWith('namespaced://'));
      const includeAll = getters.isAllNamespaces;
      const includeSystem = filters.includes('all://system');
      const includeUser = filters.includes('all://user');
      const includeOrphans = filters.includes('all://orphans');

      // Special cases to pull in all the user, system, or orphaned namespaces
      if ( includeAll || includeOrphans || includeSystem || includeUser ) {
        for ( const ns of namespaces ) {
          if (
            includeAll ||
            ( includeOrphans && !ns.projectId ) ||
            ( includeUser && !ns.isSystem ) ||
            ( includeSystem && ns.isSystem )
          ) {
            out[ns.id] = true;
          }
        }
      }

      // Individual requests for a specific project/namespace
      if ( !includeAll ) {
        for ( const filter of filters ) {
          const [type, id] = filter.split('://', 2);

          if ( !type ) {
            continue;
          }

          if ( type === 'ns' ) {
            out[id] = true;
          } else if ( type === 'project' ) {
            const project = getters['management/byId'](MANAGEMENT.PROJECT, `${ clusterId }/${ id }`);

            if ( project ) {
              for ( const ns of project.namespaces ) {
                out[ns.id] = true;
              }
            }
          }
        }
      }

      return out;
    };
  },

  defaultNamespace(state, getters, rootState, rootGetters) {
    const product = getters['currentProduct'];

    if ( !product ) {
      return 'default';
    }

    const inStore = product.inStore;
    const filteredMap = getters['namespaces']();
    const isAll = getters['isAllNamespaces'];
    const all = getters[`${ inStore }/all`](NAMESPACE).map(x => x.id);
    let out;

    function isOk() {
      if ( !out ) {
        return false;
      }

      return (isAll && all.includes(out) ) ||
             (!isAll && filteredMap && filteredMap[out] );
    }

    out = rootGetters['prefs/get'](LAST_NAMESPACE);
    if ( isOk() ) {
      return out;
    }

    out = 'default';
    if ( isOk() ) {
      return out;
    }

    if ( !isAll ) {
      const keys = Object.keys(filteredMap);

      if ( keys.length ) {
        return keys[0];
      }
    }

    return all[0];
  },

  backToRancherGlobalLink(state) {
    let link = '/g';

    if ( process.env.dev ) {
      link = `https://localhost:8000${ link }`;
    }

    return link;
  },

  backToRancherLink(state) {
    const clusterId = state.clusterId;

    let link = '/g';

    if ( clusterId ) {
      link = `/c/${ escape(clusterId) }`;
    }

    if ( process.env.dev ) {
      link = `https://localhost:8000${ link }`;
    }

    return link;
  },

  rancherLink(getters) {
    if ( process.env.dev ) {
      return `https://localhost:8000/`;
    }

    return '/';
  },

  featureFlag(state, getters, rootState, rootGetters) {
    return (name) => {
      return rootGetters['management/byId'](MANAGEMENT.FEATURE, name)?.enabled || false;
    };
  },
};

export const mutations = {
  managementChanged(state, { ready, isMultiCluster, isRancher }) {
    state.managementReady = ready;
    state.isMultiCluster = isMultiCluster;
    state.isRancher = isRancher;
  },

  clusterChanged(state, ready) {
    state.clusterReady = ready;
  },

  updateNamespaces(state, { filters, all }) {
    state.namespaceFilters = filters.filter(x => !!x);

    if ( all ) {
      state.allNamespaces = all;
    }
  },

  updateWorkspace(state, { value, all }) {
    if ( all ) {
      state.allWorkspaces = all;

      if ( findBy(all, 'id', value) ) {
        // The value is a valid option, good
      } else if ( findBy(all, 'id', 'fleet-default') ) {
        // How about the default
        value = 'fleet-default';
      } else if ( all.length ) {
        value = all[0].id;
      }
    }

    state.workspace = value;
  },

  setCluster(state, neu) {
    state.clusterId = neu;
  },

  setProduct(state, neu) {
    state.productId = neu;
  },

  setError(state, obj) {
    const err = new ApiError(obj);

    console.log('Loading error', err); // eslint-disable-line no-console

    state.error = err;
    state.cameFromError = true;
  },

  cameFromError(state) {
    state.cameFromError = true;
  }
};

export const actions = {
  async loadManagement({
    getters, state, commit, dispatch
  }) {
    if ( state.managementReady ) {
      // Do nothing, it's already loaded
      return;
    }

    console.log('Loading management...'); // eslint-disable-line no-console

    try {
      // await dispatch('rancher/findAll', { type: NORMAN.PRINCIPAL, opt: { url: 'principals' } });
    } catch (e) {
      // Maybe not Rancher
    }

    await allSettled({
      prefs:      dispatch('prefs/loadServer'),
      schemas: Promise.all([
        dispatch('management/subscribe'),
        dispatch('management/loadSchemas', true),
      ]),
    });

    const isMultiCluster = !!getters['management/schemaFor'](MANAGEMENT.PROJECT);

    const promises = {
      // Clusters guaranteed always available or your money back
      // clusters: dispatch('management/findAll', {
      //   type: MANAGEMENT.CLUSTER,
      //   opt:  { url: MANAGEMENT.CLUSTER }
      // }),
    };
    const isRancher = getters['auth/isRancher'];

    if (isRancher) {
      promises['rancherSubscribe'] = dispatch('rancher/subscribe');
      promises['rancherSchema'] = dispatch('rancher/loadSchemas', true);

      if ( getters['management/schemaFor'](COUNT) ) {
        promises['counts'] = dispatch('management/findAll', { type: COUNT });
      }

      if ( getters['management/schemaFor'](MANAGEMENT.SETTING) ) {
        promises['settings'] = dispatch('management/findAll', { type: MANAGEMENT.SETTING });
      }

      if ( getters['management/schemaFor'](NAMESPACE) ) {
        promises['namespaces'] = dispatch('management/findAll', { type: NAMESPACE });
      }

      if ( getters['management/schemaFor'](FLEET.WORKSPACE) ) {
        promises['workspaces'] = dispatch('management/findAll', { type: FLEET.WORKSPACE });
      }
    }

    const res = await allSettled(promises);

    commit('managementChanged', {
      ready: true,
      isMultiCluster
    });

    if ( res.workspaces ) {
      commit('updateWorkspace', {
        value: getters['prefs/get'](WORKSPACE),
        all:   res.workspaces,
      });
    }

    console.log(`Done loading management; isMultiCluster=${ isMultiCluster }`); // eslint-disable-line no-console
  },

  async loadCluster({
    state, commit, dispatch, getters
  }, id) {
    const isMultiCluster = getters['isMultiCluster'];
    const isRancher = getters['isRancher'];

    if ( state.clusterReady && state.clusterId && state.clusterId === id ) {
      // Do nothing, we're already connected/connecting to this cluster
      return;
    }

    if ( state.clusterId && id ) {
      // Clear the old cluster state out if switching to a new one.
      // If there is not an id then stay connected to the old one behind the scenes,
      // so that the nav and header stay the same when going to things like prefs
      commit('clusterChanged', false);

      await dispatch('cluster/unsubscribe');
      await dispatch('clusterExternal/unsubscribe');
      commit('cluster/reset');

      // await dispatch('management/watch', {
      //   type:      MANAGEMENT.PROJECT,
      //   namespace: state.clusterId,
      //   stop:      true
      // });
      // commit('management/forgetType', MANAGEMENT.PROJECT);

      commit('catalog/reset');
      commit('clusterChanged', false);
    }

    if ( id ) {
      // Remember the new one
      dispatch('prefs/set', { key: CLUSTER_PREF, value: id });
      commit('setCluster', id);
    } else if ( isMultiCluster ) {
      // Switching to a global page with no cluster id, keep it the same.
      return;
    }

    // console.log(`Loading ${ isMultiCluster ? 'ECM ' : '' }cluster...`); // eslint-disable-line no-console

    // See if it really exists
    // const cluster = await dispatch('management/find', {
    //   type: MANAGEMENT.CLUSTER,
    //   id,
    //   opt:  { url: `${ MANAGEMENT.CLUSTER }s/${ escape(id) }` }
    // });

    // const clusterBase = `/k8s/clusters/${ escape(id) }/v1`;
    const clusterBase = `/v1`;
    const externalBase = `/v1/management.cattle.io.clusters`;

    // if ( !cluster ) {
    //   commit('setCluster', null);
    //   commit('cluster/applyConfig', { baseUrl: null });
    //   throw new ClusterNotFoundError(id);
    // }

    // Update the Steve client URLs
    commit('cluster/applyConfig', { baseUrl: clusterBase });

    await Promise.all([
      dispatch('cluster/loadSchemas', true),
    ]);

    dispatch('cluster/subscribe');

    // const projectArgs = {
    //   type: MANAGEMENT.PROJECT,
    //   opt:  {
    //     url:            `${ MANAGEMENT.PROJECT }/${ escape(id) }`,
    //     watchNamespace: id
    //   }
    // };

    const VMI = 'kubevirt.io.virtualmachineinstance';

    const res = await allSettled({
      // projects:   isMultiCluster && dispatch('management/findAll', projectArgs),
      counts:          dispatch('cluster/findAll', { type: COUNT, opt: { url: 'counts' } }),
      namespaces:      dispatch('cluster/findAll', { type: NAMESPACE, opt: { url: 'namespaces' } }),
      vmi:             dispatch('cluster/findAll', { type: VMI, opt: { url: `${ VMI }s` } }),
      vmim:            dispatch('cluster/findAll', { type: VMIM, opt: { url: `${ VMIM }s` } }),
      vm:              dispatch('cluster/findAll', { type: VM, opt: { url: `${ VM }s` } }),
      image:           dispatch('cluster/findAll', { type: IMAGE, opt: { url: `${ IMAGE }s` } }),
      template:        dispatch('cluster/findAll', { type: VM_TEMPLATE.template, opt: { url: `${ VM_TEMPLATE.template }s` } }),
      templateVersion: dispatch('cluster/findAll', { type: VM_TEMPLATE.version, opt: { url: `${ VM_TEMPLATE.version }s` } }),
      ssh:             dispatch('cluster/findAll', { type: SSH, opt: { url: `${ SSH }s` } }),
      DATA_VOLUME:     dispatch('cluster/findAll', { type: DATA_VOLUME, opt: { url: `${ DATA_VOLUME }s` } }),
      pods:            dispatch('cluster/findAll', { type: POD }),
      setting:         dispatch('cluster/findAll', { type: HARVESTER_SETTING }),
      nodes:           dispatch('cluster/findAll', { type: NODE }),
      restores:        dispatch('cluster/findAll', { type: HARVESTER_RESTORE }),
      network:         dispatch('cluster/findAll', { type: NETWORK_ATTACHMENT, opt: { url: 'k8s.cni.cncf.io.network-attachment-definitions' } })
    });

    commit('updateNamespaces', {
      filters: getters['prefs/get'](NAMESPACE_FILTERS),
      all:     res.namespaces
    });

    commit('clusterChanged', true);

    console.log('Done loading cluster.'); // eslint-disable-line no-console
  },

  switchNamespaces({ commit, dispatch }, value) {
    dispatch('prefs/set', { key: NAMESPACE_FILTERS, value });
    commit('updateNamespaces', { filters: value });
  },

  async onLogout({ dispatch, commit, state }) {
    await dispatch('management/unsubscribe');
    commit('managementChanged', { ready: false });
    commit('management/reset');

    await dispatch('cluster/unsubscribe');
    commit('clusterChanged', false);
    commit('setCluster', null);
    commit('cluster/reset');

    const isRancher = getters['auth/isRancher'];
    if (isRancher) {
      await dispatch('rancher/unsubscribe');
      commit('rancher/reset');
      commit('catalog/reset');
    }

    const router = state.$router;
    const route = router.currentRoute;

    if ( route.name === 'index' ) {
      router.replace('/auth/login');
    } else {
      const QUERY = (LOGGED_OUT in route.query) ? LOGGED_OUT : TIMED_OUT;

      router.replace(`/auth/login?${ QUERY }`);
    }
  },

  nuxtServerInit({ dispatch, rootState }, nuxt) {
    // Models in SSR server mode have no way to get to the route or router, so hack one in...
    Object.defineProperty(rootState, '$router', { value: nuxt.app.router });
    Object.defineProperty(rootState, '$route', { value: nuxt.route });
    dispatch('prefs/loadCookies');
  },

  nuxtClientInit({ dispatch, rootState }, nuxt) {
    Object.defineProperty(rootState, '$router', { value: nuxt.app.router });
    Object.defineProperty(rootState, '$route', { value: nuxt.route });

    dispatch('management/rehydrateSubscribe');
    dispatch('cluster/rehydrateSubscribe');

    if ( rootState.isRancher ) {
      dispatch('rancher/rehydrateSubscribe');
    }

    dispatch('auth/getAuthModes');
    dispatch('prefs/loadCookies');
    dispatch('prefs/loadTheme');
  },

  loadingError({ commit, state }, err) {
    commit('setError', err);
    const router = state.$router;

    router.replace('/fail-whale');
  }
};
