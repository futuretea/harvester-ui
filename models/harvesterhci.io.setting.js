import { findBy } from '@/utils/array';
import { HARVESTER_ALLOWED_SETTINGS } from '@/config/settings';

export default {
  _availableActions() {
    const out = this._standardActions;

    const toFilter = ['goToClone', 'promptRemove'];

    const actions = out.map((O) => {
      const enabled = toFilter.includes(O.action) ? false : O.enabled;
      const bulkable = toFilter.includes(O.action) ? false : O?.bulkable;

      return {
        ...O,
        enabled,
        bulkable
      };
    });

    return actions;
  },

  formatValue() {
    let out;
    const setting = HARVESTER_ALLOWED_SETTINGS[this.id];

    const v = this.value || this.default;

    if (setting.kind === 'json') {
      out = JSON.stringify(JSON.parse(v), null, 2);
    } else if (setting.kind === 'enum') {
      out = `advancedSettings.enum.${ setting }.${ v }`;
    } else {
      out = v;
    }

    return out;
  },

  customized() {
    const setting = HARVESTER_ALLOWED_SETTINGS[this.id];
    const readonly = !!setting.readOnly;

    return !readonly && this.value && this.value !== this.default;
  },

  configuredCondition() {
    return findBy((this?.status?.conditions || []), 'type', 'configured') || {};
  },

  valueOrDefaultValue() {
    return this.value || this.default;
  },

  upgradeableVersion() {
    const value = this.value || '';

    if (!value) {
      return [];
    }

    return value.split(',').sort((a, b) => {
      return a > b ? -1 : 1;
    }).map( (V) => {
      return {
        label: V,
        value: V
      };
    });
  },

  currentVersion() {
    return this.value || '';
  },

  displayValue() { // Select the field you want to display
    if (this.id === 'backup-target') {
      return this.parseValue?.endpoint || ' ';
    }

    return null;
  },

  parseValue() {
    let parseDefaultValue = {};

    try {
      parseDefaultValue = JSON.parse(this.value);
    } catch (err) {
      parseDefaultValue = JSON.parse(this.default);
    }

    return parseDefaultValue;
  },

  isS3() {
    return this.parseValue.type === 's3';
  },

  isNFS() {
    return this.parseValue.type === 'nfs';
  },

  bakcupError() {
    const configured = findBy((this?.status?.conditions || []), 'type', 'configured') || {};

    return configured.status === 'False' || configured.status === undefined;
  },

  errorBackupTargetMessage() {
    const configured = findBy((this?.status?.conditions || []), 'type', 'configured') || {};

    return configured.reason;
  },

  customValidationRules() {
    const id = this.id;

    const out = [];

    switch (id) {
    case 'backup-target':
      out.push( {
        nullable:       false,
        path:           'value',
        required:       true,
        type:           'string',
        validators:     ['backupTarget'],
      });
      break;
    }

    return out;
  },
};
