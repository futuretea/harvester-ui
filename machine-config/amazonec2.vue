<script>
import Loading from '@/components/Loading';
import Banner from '@/components/Banner';
import CreateEditView from '@/mixins/create-edit-view';
import LabeledSelect from '@/components/form/LabeledSelect';
import LabeledInput from '@/components/form/LabeledInput';
import KeyValue from '@/components/form/KeyValue';
import UnitInput from '@/components/form/UnitInput';
import RadioGroup from '@/components/form/RadioGroup';
import Checkbox from '@/components/form/Checkbox';
import { SECRET } from '@/config/types';
import { allHash } from '@/utils/promise';
import { addObject, addObjects, findBy } from '@/utils/array';
import { sortBy } from '@/utils/sort';
import { stringify, exceptionToErrorsArray } from '@/utils/error';

const DEFAULT_GROUP = 'rancher-nodes';

export default {
  components: {
    Banner, Loading, LabeledInput, LabeledSelect, Checkbox, RadioGroup, UnitInput, KeyValue
  },

  mixins: [CreateEditView],

  props: {
    credentialId: {
      type:     String,
      required: true,
    },
  },

  async fetch() {
    this.errors = [];
    if ( !this.credentialId ) {
      return;
    }

    try {
      if ( this.credential?.id !== this.credentialId ) {
        this.credential = await this.$store.dispatch('management/find', { type: SECRET, id: this.credentialId });
      }

      if ( !this.instanceInfo ) {
        this.instanceInfo = await this.$store.dispatch('aws/instanceInfo');
      }

      const region = this.value.region || this.credential?.decodedData.defaultRegion || this.$store.getters['aws/defaultRegion'];
      const cloudCredentialId = this.credential.id;

      if ( !this.value.region ) {
        this.$set(this.value, 'region', region);
      }

      this.ec2Client = await this.$store.dispatch('aws/ec2', { region, cloudCredentialId });
      this.kmsClient = await this.$store.dispatch('aws/kms', { region, cloudCredentialId });

      const hash = {};

      if ( !this.regionInfo ) {
        hash.regionInfo = this.ec2Client.describeRegions({});
      }

      if ( this.loadedRegionalFor !== region ) {
        hash.zoneInfo = await this.ec2Client.describeAvailabilityZones({});
        hash.vpcInfo = await this.ec2Client.describeVpcs({});
        hash.subnetInfo = await this.ec2Client.describeSubnets({});
        hash.securityGroupInfo = await this.ec2Client.describeSecurityGroups({});
      }

      const res = await allHash(hash);

      for ( const k in res ) {
        this[k] = res[k];
      }

      try {
        this.kmsInfo = await this.kmsClient.listKeys({});
        this.canReadKms = true;
      } catch (e) {
        this.canReadKms = false;
      }

      if ( !this.value.zone ) {
        this.$set(this.value, 'zone', 'a');
      }

      if ( !this.value.instanceType ) {
        this.$set(this.value, 'instanceType', this.$store.getters['aws/defaultInstanceType']);
      }

      this.initNetwork();
      this.initTags();

      if ( !this.value.securityGroup?.length ) {
        this.$set(this.value, 'securityGroup', [DEFAULT_GROUP]);
      }

      if ( this.value.securityGroup?.length === 1 && this.value.securityGroup[0] === DEFAULT_GROUP ) {
        this.securityGroupMode = 'default';
      } else {
        this.securityGroupMode = 'custom';
      }

      this.loadedRegionalFor = region;
    } catch (e) {
      this.errors = exceptionToErrorsArray(e);
    }
  },

  data() {
    return {
      ec2Client:         null,
      kmsClient:         null,
      credential:        null,
      instanceInfo:      null,
      regionInfo:        null,
      canReadKms:        null,
      kmsInfo:           null,
      tags:              null,
      loadedRegionalFor: null,
      zoneInfo:          null,
      vpcInfo:           null,
      subnetInfo:        null,
      securityGroupInfo: null,
      selectedNetwork:   null,
      securityGroupMode: null,
      showAdvanced:      false,
    };
  },

  computed: {
    instanceOptions() {
      let lastGroup;

      const out = [];

      for ( const row of this.instanceInfo ) {
        if ( row.groupLabel !== lastGroup ) {
          out.push({
            kind:     'group',
            disabled: true,
            label:    row.groupLabel
          });

          lastGroup = row.groupLabel;
        }

        out.push({
          label: row['label'],
          value: row['apiName'],
        });
      }

      return out;
    },

    regionOptions() {
      if ( !this.regionInfo ) {
        return [];
      }

      return this.regionInfo.Regions.map((obj) => {
        return obj.RegionName;
      }).sort();
    },

    zoneOptions() {
      if ( !this.zoneInfo ) {
        return [];
      }

      return this.zoneInfo.AvailabilityZones.map((obj) => {
        return obj.ZoneName.substr(-1);
      }).sort();
    },

    networkOptions() {
      if ( !this.vpcInfo || !this.subnetInfo ) {
        return [];
      }

      let vpcs = [];
      const subnetsByVpc = {};

      for ( const obj of this.vpcInfo.Vpcs ) {
        vpcs.push({
          label:     `${ obj.VpcId } (${ obj.CidrBlock })`,
          isDefault: obj.IsDefault || false,
          kind:      'vpc',
          value:     obj.VpcId,
        });
      }

      vpcs = sortBy(vpcs, ['isDefault:desc', 'label']);

      for ( const obj of this.subnetInfo.Subnets ) {
        if ( obj.AvailabilityZone !== `${ this.value.region }${ this.value.zone }` ) {
          continue;
        }

        let entry = subnetsByVpc[obj.VpcId];

        if ( !entry ) {
          entry = [];
          subnetsByVpc[obj.VpcId] = entry;
        }

        entry.push({
          label:     `${ obj.SubnetId } (${ obj.CidrBlock } - ${ obj.AvailableIpAddressCount } available)`,
          kind:      'subnet',
          isDefault: obj.DefaultForAz || false,
          value:     obj.SubnetId,
          vpcId:     obj.VpcId,
        });
      }

      const out = [];

      for ( const obj of vpcs ) {
        addObject(out, obj);

        if ( subnetsByVpc[obj.value] ) {
          addObjects(out, sortBy(subnetsByVpc[obj.value], ['isDefault:desc', 'label']));
        }
      }

      return out;
    },

    securityGroupOptions() {
      if ( !this.securityGroupInfo ) {
        return [];
      }

      const out = this.securityGroupInfo.SecurityGroups.filter((obj) => {
        return obj.VpcId === this.value.vpcId;
      }).map((obj) => {
        return {
          label:       obj.GroupName,
          description: obj.GroupDescription,
          value:       obj.GroupId
        };
      });

      return sortBy(out, 'label');
    },

    kmsOptions() {
      if ( !this.kmsInfo ) {
        return [];
      }

      const out = this.kmsInfo.Keys.map((obj) => {
        return obj.KeyArn;
      }).sort();

      return out;
    },

    DEFAULT_GROUP() {
      return DEFAULT_GROUP;
    }
  },

  watch: {
    'credentialId'() {
      this.$fetch();
    },

    'value.region'() {
      this.$fetch();
    },

    'value.zone'() {
      this.$fetch();
    },

    'securityGroupMode'(val) {
      this.value.securityGroupReadonly = ( val === 'default' );
    },
  },

  methods: {
    stringify,

    toggleAdvanced() {
      this.showAdvanced = !this.showAdvanced;
    },

    initNetwork() {
      const id = this.value.subnetId || this.value.vpcId;

      this.selectedNetwork = id;
    },

    updateNetwork(value) {
      let obj;

      if ( value ) {
        obj = findBy(this.networkOptions, 'value', value);
      }

      if ( obj?.kind === 'subnet' ) {
        this.value.subnetId = value;
        this.value.vpcId = obj.vpcId;
        this.selectedNetwork = value;
      } else if ( obj ) {
        this.value.subnetId = null;
        this.value.vpcId = value;
        this.selectedNetwork = value;
      } else {
        this.value.subnetId = null;
        this.value.vpcId = null;
        this.selectedNetwork = null;
      }
    },

    initTags() {
      const parts = (this.value.tags || '').split(/,/);
      const out = {};

      let i = 0;

      while ( i + 1 < parts.length ) {
        const key = `${ parts[i] }`.trim();
        const value = `${ parts[i + 1] }`.trim();

        if ( key ) {
          out[key] = value;
        }

        i += 2;
      }

      this.tags = out;
    },

    updateTags(tags) {
      const ary = [];

      for ( const k in tags ) {
        ary.push(k, tags[k]);
      }

      this.$set(this.value, 'tags', ary.join(','));
    },
  },
};
</script>

<template>
  <div>
    <Loading v-if="$fetchState.pending" />
    <div v-else-if="errors.length">
      <div
        v-for="(err, idx) in errors"
        :key="idx"
      >
        <Banner
          color="error"
          :label="stringify(err)"
        />
      </div>
    </div>
    <div v-else-if="loadedRegionalFor" class="mt-20">
      <div class="row mb-20">
        <div class="col span-6">
          <LabeledSelect
            v-model="value.region"
            :mode="mode"
            :options="regionOptions"
            :required="true"
            :searchable="true"
            label="Region"
          />
        </div>
        <div class="col span-6">
          <LabeledSelect
            v-model="value.zone"
            :mode="mode"
            :options="zoneOptions"
            :required="true"
            label="Zone"
          />
        </div>
      </div>
      <div class="row mb-20">
        <div class="col span-9">
          <LabeledSelect
            v-model="value.instanceType"
            :mode="mode"
            :options="instanceOptions"
            :required="true"
            :selectable="option => !option.disabled"
            :searchable="true"
            label="Instance Type"
          >
            <template v-slot:option="opt">
              <template v-if="opt.kind === 'group'">
                <b>{{ opt.label }}</b>
              </template>
              <template v-else>
                <span class="pl-10">{{ opt.label }}</span>
              </template>
            </template>
          </LabeledSelect>
        </div>
        <div class="col span-3">
          <UnitInput v-model="value.rootSize" :mode="mode" placeholder="Default: 16" label="Root Disk Size" suffix="GB" />
        </div>
      </div>
      <div class="row mt-20 mb-20">
        <div class="col span-6">
          <LabeledSelect
            :mode="mode"
            :value="selectedNetwork"
            :options="networkOptions"
            :searchable="true"
            :required="true"
            label="VPC/Subnet"
            placeholder="Select a VPC or Subnet"
            @input="updateNetwork($event)"
          >
            <template v-slot:option="opt">
              <template v-if="opt.kind === 'vpc'">
                <b>{{ opt.label }}</b>
              </template>
              <template v-else>
                <span class="pl-10">{{ opt.label }}</span>
              </template>
            </template>
          </LabeledSelect>
        </div>
        <div class="col span-6">
          <LabeledInput
            v-model="value.iamInstanceProfile"
            :mode="mode"
            label="IAM Instance Profile Name"
            tooltip="Kubernetes AWS Cloud Provider support requires an appropriate instance profile"
          />
        </div>
      </div>

      <template v-if="showAdvanced">
        <a v-t="'generic.hideAdvanced'" @click="toggleAdvanced" />

        <div class="row mt-20">
          <div class="col span-6">
            <LabeledInput
              v-model="value.ami"
              :mode="mode"
              label="AMI ID"
              placeholder="Default: A recent Ubuntu LTS"
            />
          </div>
          <div class="col span-6">
            <LabeledInput
              v-model="value.sshUser"
              :mode="mode"
              label="SSH Username for AMI"
              :disabled="!value.ami"
              placeholder="Default: ubuntu"
              tooltip="The username that exists in the selected AMI; Provisioning will SSH to the node with this."
            />
          </div>
        </div>

        <div class="row mt-20">
          <div class="col span-12">
            <h3>
              Security Group
              <span v-if="!value.vpcId" class="text-muted text-small">
                (select a VPC/Subnet first)
              </span>
            </h3>
            <RadioGroup
              v-model="securityGroupMode"
              name="securityGroupMode"
              :mode="mode"
              :disabled="!value.vpcId"
              :labels="[`Standard: Automatically create and use a &quot;${DEFAULT_GROUP}&quot; security group`, 'Choose one or more existing security groups:']"
              :options="['default','custom']"
            />
            <LabeledSelect
              v-if="value.vpcId && securityGroupMode === 'custom'"
              v-model="value.securityGroup"
              :mode="mode"
              :disabled="!value.vpcId"
              :options="securityGroupOptions"
              :searchable="true"
              :multiple="true"
              :taggable="true"
            />
          </div>
        </div>

        <div class="row mt-20">
          <div class="col span-6">
            <LabeledInput
              v-model="value.volumeType"
              :mode="mode"
              label="EBS Root Volume Type"
              placeholder="Default: gp2"
            />
          </div>
        </div>

        <div class="row mt-20">
          <div class="col span-12">
            <Checkbox v-model="value.encryptEbsVolume" :mode="mode" label="Encrypt EBS Volume" />
            <div v-if="value.encryptEbsVolume" class="mt-10">
              <LabeledSelect
                v-if="canReadKms"
                v-model="value.kmsKey"
                :mode="mode"
                :options="kmsOptions"
                label="KMS Key ARN"
              />
              <template v-else>
                <LabeledInput
                  v-model="value.kmsKey"
                  :mode="mode"
                  label="KMS Key ARN"
                />
                <p class="text-muted">
                  You do not have permission to list KMS keys, but may still be able to enter a Key ARN if you know one.
                </p>
              </template>
            </div>
          </div>
        </div>
        <div class="row mt-20">
          <div class="col span-6">
            <Checkbox v-model="value.requestSpotInstance" :mode="mode" label="Request Spot Instance" />
            <div v-if="value.requestSpotInstance" class="mt-10">
              <UnitInput v-model="value.spotPrice" :mode="mode" placeholder="Default: 0.50" label="Spot Price" suffix="Dollars per hour" />
            </div>
          </div>
        </div>

        <div class="row mt-20">
          <div class="col span-12">
            <div><Checkbox v-model="value.privateAddressOnly" :mode="mode" label="Use only private addresses" /></div>
            <div><Checkbox v-model="value.useEbsOptimizedInstance" :mode="mode" label="EBS-Optimized Instance" /></div>
            <div><Checkbox v-model="value.httpEndpoint" :mode="mode" label="Allow access to EC2 metadata" /></div>
            <div><Checkbox v-model="value.httpTokens" :mode="mode" :disabled="!value.httpEndpoint" label="Use tokens for metadata" /></div>
          </div>
        </div>

        <div class="row mt-20">
          <div class="col span-12">
            <KeyValue
              :value="tags"
              :mode="mode"
              :read-allowed="false"
              title="Tags"
              @input="updateTags"
            >
            </keyvalue>
          </div>
        </div>
      </template>
      <a v-else v-t="'generic.showAdvanced'" @click="toggleAdvanced" />
    </div>
  </div>
</template>
