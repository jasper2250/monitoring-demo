const fs = require('fs');
const yamljs = require('yamljs');
const jsyaml = require('js-yaml');
const shell = require('shelljs');
const msRestAzure = require('ms-rest-azure');
const ComputeManagementClient = require('azure-arm-compute');
const NetworkManagementClient = require('azure-arm-network');

let input=yamljs.parse(fs.readFileSync('./monitoring.yaml').toString());
let promtail=yamljs.parse(fs.readFileSync('./js/promtail-template.yaml').toString());

let clientId = '807c401e-aa01-43cc-a0a6-ae6bca922285';
let secret = fs.readFileSync('/pwd/key', 'utf-8');
console.log(secret);
let domain = 'a19f121d-81e1-4858-a9d8-736e267fd4c7';
// let subId = '309cb9ec-c77d-4840-bd35-e41fcf3307ff';


msRestAzure.loginWithServicePrincipalSecret(clientId, secret, domain, function (err, credentials, subscriptions) {
    if (err) {
        throw new Error(err);
    }
    obtainYaml(credentials);
})

function assiginObj(target = {},sources= {}){
    let obj = target;
    if(typeof target != 'object' || typeof sources != 'object'){
        return sources;
    }
    for(let key in sources){
        if(target.hasOwnProperty(key)){
            obj[key] = assiginObj(target[key],sources[key]);
        } else {
            obj[key] = sources[key];
        }
    }
    return obj;
}

let mergeStageToGlb=function(gbl,stage){
    if(!stage){
        return gbl;
    }
    stage.forEach(stageTarget=>{
        let gblTarget = gbl.filter(g=>g.name==stageTarget.name).concat(stageTarget).shift();
        if (gblTarget != stageTarget){
            assiginObj(gblTarget,stageTarget);
        }else{
            if(stageTarget.logs){
                let gblmetric = gblTarget.filter(g=>g.logs.name==stageTarget.logs.name).concat(stageTarget).shift();
                if (gblmetric != stageTarget){
                    assiginObj(gblTarget,stageTarget);
                } else {
                    gbl.push(stageTarget);
                }
            }
        }
    });
    return gbl;
}

/**
 * get VM ip
 * @param {*} name 
 * @param {*} rg 
 * @param {*} subsId 
 * @param {*} credentials 
 * @returns 
 */
let getVmIp = async (name, rg, subsId, credentials) => {

    let computeClient = new ComputeManagementClient(credentials, subsId);
    //get vm detail
    let virtualMachineDetail = await computeClient.virtualMachines.get(rg, name);
    let networkInterface = virtualMachineDetail.networkProfile.networkInterfaces[0].id;
    //get networkInterface name
    let networkInterfaceName = networkInterface.substring(networkInterface.lastIndexOf('/') + 1, networkInterface.length);

    let networkManagementClient = new NetworkManagementClient(credentials, subsId);
    //get network detail
    let networkDetail = await networkManagementClient.networkInterfaces.get(rg, networkInterfaceName);
    //get vm ip
    let vmIp = networkDetail.ipConfigurations[0].privateIPAddress;
    return vmIp;
}

/**
 * get VMSS ips
 * @param {*} name 
 * @param {*} rg 
 * @param {*} subsId 
 * @param {*} credentials 
 * @returns 
 */
let getVmssIps = async (name, rg, subsId, credentials) => {
    let computeClient = new ComputeManagementClient(credentials, subsId);
    //get vmss list
    let vmList = await computeClient.virtualMachineScaleSetVMs.list(rg, name);
    let vmssIps = [];
    for(let i = 0; i<vmList.length; i++){
        let networkInterface = vmList[0].networkProfile.networkInterfaces[0].id;
        //get networkInterface name
        let networkInterfaceName = networkInterface.substring(networkInterface.lastIndexOf('/') + 1, networkInterface.length);
        let networkManagementClient = new NetworkManagementClient(credentials, subsId);
        //get vmss vm ip
        let ip = await networkManagementClient.networkInterfaces.getVirtualMachineScaleSetNetworkInterface(rg, name, vmList[i].instanceId, networkInterfaceName)
        // console.log(JSON.stringify(ip));
        vmssIps.push(ip.ipConfigurations[0].privateIPAddress);
    }
    return vmssIps;
}

/**
 * make promtail config file
 * @param {*} targets 
 * @param {*} promtail 
 * @param {*} resourceGroup 
 * @param {*} subscriptionId 
 * @param {*} stageName 
 * @param {*} credentials 
 */
let writeConfigFile = function(targets, promtail, resourceGroup, subscriptionId, stageName, credentials){
    targets.forEach(target => {
        let targetName = target.name;
        promtail.scrape_configs = [];
        target.logs.forEach(log => {
            let job = {};
            job.job_name = log.name;
            job.static_configs = [];
            job.static_configs[0] = {};
            job.static_configs[0].targets = [];
            job.static_configs[0].targets[0] = 'localhost';
            job.static_configs[0].labels = {};
            job.static_configs[0].labels.job = targetName + log.name;
            job.static_configs[0].labels.__path__ = log.path;
            if(log.label){
                log.label.forEach(l => {
                    job.static_configs[0].labels[l.name] = l.value;
                })
            }

            promtail.scrape_configs.push(job);
        });
        if(target.type === 'azure-vm-scale-set'){
            let vmssNames = target.scaleSetName;
            vmssNames.forEach(vmssName => {
                getVmssIps(vmssName, resourceGroup, subscriptionId, credentials).then(vmssIps => {
                    vmssIps.forEach(vmssIp => {
                        shell.mkdir('-p', './ansible-playbook/roles/promtail/files/config/'.concat(vmssIp));
                        let config=jsyaml.dump(promtail);
                        fs.writeFileSync('./ansible-playbook/roles/promtail/files/config/'.concat(vmssIp).concat('/promtail-config.yml'),config);
                        console.log('make promtail config success. stage:%s, target:%s, vmss:%s, ip:%s', stageName, target.name, vmssName, vmssIp);
                    })
                });
            })
        }else if(target.type === 'azure-vm-instance'){
            let vmNames = target.instanceName;
            vmNames.forEach(vmName => {
                getVmIp(vmName, resourceGroup, subscriptionId, credentials).then(result => {
                    shell.mkdir('-p', './ansible-playbook/roles/promtail/files/config/'.concat(result));
                    let config=jsyaml.dump(promtail);
                    fs.writeFileSync('./ansible-playbook/roles/promtail/files/config/'.concat(result).concat('/promtail-config.yml'),config);
                    console.log('make promtail config success. stage:%s, target:%s, vm:%s, ip:%s', stageName, target.name, vmName, result)
                })
            })
        }else if(target.type === 'static-host'){
            let hosts = target.host;
            hosts.forEach(host => {
                shell.mkdir('-p', './ansible-playbook/roles/promtail/files/config/'.concat(host));
                let config=jsyaml.dump(promtail);
                fs.writeFileSync('./ansible-playbook/roles/promtail/files/config/'.concat(host).concat('/promtail-config.yml'),config);
                console.log('make promtail config success. stage:%s, target:%s, host:%s', stageName, target.name, host)
            })
        }
        
    });
}

/**
 * obtain monitoring.yaml
 * @param {*} credentials 
 */
let obtainYaml = function(credentials){
    let namespace = input.namespace;
    let publicRg;
    if(input.cloudConfig && input.cloudConfig.azure && input.cloudConfig.azure.resourceGroup){
        publicRg = input.cloudConfig.azure.resourceGroup;
    }

    input.stages.forEach(stage => {
        let stageName = stage.name;
        let resourceGroup = publicRg;
        if(stage.cloudConfig && stage.cloudConfig.azure && stage.cloudConfig.azure.resourceGroup){
            resourceGroup = stage.cloudConfig.azure.resourceGroup;
        }
        let subscriptionId;
        if(stage.cloudConfig && stage.cloudConfig.azure && stage.cloudConfig.azure.subscriptionId){
            subscriptionId = stage.cloudConfig.azure.subscriptionId;
        }
        //get loki server url by stage
        let lokiUrl = 'http://loki.' + namespace + '.'+stageName+'.342586163.ga/loki/api/v1/push';
        promtail.clients[0].url = lokiUrl;

        let targets = stage.targets;
        if(targets){
            let mergeTargets = mergeStageToGlb(input.targets, targets);
            writeConfigFile(mergeTargets, promtail, resourceGroup, subscriptionId, stageName, credentials);
        }else{
            writeConfigFile(input.targets, promtail, resourceGroup, subscriptionId, stageName, credentials);
        }
    });
}