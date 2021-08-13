const fs = require('fs');
const path = require('path');
const yamljs = require('yamljs');
const jsyaml = require('js-yaml');
var input=yamljs.parse(fs.readFileSync('./monitoring.yaml').toString());
console.log(input);
var promethues=yamljs.parse(fs.readFileSync('./prometheus.yml').toString());
var tenantId = input.cloudConfig.azure.tenantId;
var subscriptionId = input.stages[0].cloudConfig.azure.subscriptionId;
var resourceGroup = input.cloudConfig.azure.resourceGroup;
var isreload = false;
var exitargets = [];
var customtargets = [];
Array.prototype.indexOf = function(val) {
    for (var i = 0; i < this.length; i++) {
        if (this[i] == val) return i;
    }
    return -1;
};

Array.prototype.remove = function(val) {
    var index = this.indexOf(val);
    if (index > -1) {
        this.splice(index, 1);
    }
};


function isObj(object) {
    return object && typeof(object) == 'object' && Object.prototype.toString.call(object).toLowerCase() == "[object object]";
}

function isArray(object) {
    return object && typeof(object) == 'object' && object.constructor == Array;
}

function getLength(object) {
    var count = 0;
    for(var i in object) count++;
    return count;
}

function CompareJsonObj(objA, objB) {
    if(!isObj(objA) || !isObj(objB)) return false;
    if(getLength(objA) != getLength(objB)) return false;
    return CompareObj(objA, objB, true);
}

function CompareObj(objA, objB, flag) {
    if(getLength(objA) != getLength(objB)) return false;
    for(var key in objA) {
        if(!flag)
            break;
        if(!objB.hasOwnProperty(key)) {
            flag = false;
            break;
        }
        if(!isArray(objA[key])) {
            if (isObj(objA[key])) {
                if (isObj(objB[key])) {
        	    if(!flag)
                        break;
        	    flag = CompareObj(objA[key], objB[key], flag);
        	} else {
        	    flag = false;
                    break;
        	}
            } else {
        	if(String(objB[key]) != String(objA[key])) {
            	    flag = false;
                    break;
                }
            }
        } else {
            if(!isArray(objB[key])) {
                flag = false;
                break;
            }
            var oA = objA[key],
                oB = objB[key];
            if(oA.length != oB.length) {
                flag = false;
                break;
            }
            for(var k in oA) {
                if(!flag)
                    break;
                flag = CompareObj(oA[k], oB[k], flag);
            }
        }
    }
    return flag;
}

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

let merge=function(gbl,stage){
    stage.forEach(stgTarget=>{
        let gblTarget = gbl.filter(g=>g.name==stgTarget.name).concat(stgTarget).shift();
        if (gblTarget != stgTarget){
            assiginObj(gblTarget,stgTarget);
        }else{
            let gblmetric = gblTarget.filter(g=>g.metrics.name==stgTarget.metrics.name).concat(stgTarget).shift();
            if (gblmetric != stgTarget){
                assiginObj(gblTarget,stgTarget);
            } else {
                gbl.push(stgTarget);
            }
        }
    });
    return gbl;
}

function addtarget(params){
    var config=yamljs.parse(fs.readFileSync('/azurefile/prometheus/targets/prometheus.yml').toString());
    config.scrape_configs.push(params);
    config=jsyaml.dump(config);
    fs.writeFileSync('/azurefile/prometheus/targets/prometheus.yml',config);
    //console.log("addtarget 成功");
}
function replacetarget(jobname,target){
    var config=yamljs.parse(fs.readFileSync('/azurefile/prometheus/targets/prometheus.yml').toString());
    for(var i = 0; i < config.scrape_configs.length;i++){
        if(jobname == config.scrape_configs[i].job_name){
            config.scrape_configs.splice(i,1,target);
        }
    }
    config=jsyaml.dump(config);
    fs.writeFileSync('/azurefile/prometheus/targets/prometheus.yml',config);
    //console.log("replacetarget 成功");
}
function removetarget(jobname){
    var config=yamljs.parse(fs.readFileSync('/azurefile/prometheus/targets/prometheus.yml').toString());
    for(var i = 0; i < config.scrape_configs.length;i++){
        if(jobname == config.scrape_configs[i].job_name){
            config.scrape_configs.splice(i,1);
        }
    }
    config=jsyaml.dump(config);
    fs.writeFileSync('/azurefile/prometheus/targets/prometheus.yml',config);
    //console.log("removetarget 成功");
}

let azure_sd_data={
  "job_name": null,
  "scrape_timeout": "1s",
  "metrics_path": "/metrics",
  "scrape_interval": "15s",
  "azure_sd_configs": [
    {
      "environment": "AzurePublicCloud",
      "subscription_id": null,
      "tenant_id": null,
      "client_id": null,
      "client_secret": null,
      "refresh_interval": "300s",
      "port": "80"
    }
  ]
};

let static_configs_data={
    "job_name":null,
    "scrape_timeout": "1s",
    "metrics_path": "/metrics",
    "scrape_interval": "15s",
    "static_configs":[
        {
            "targets":[

            ]
        }
    ]
}

let updateazuretarget=function(prometheustargets,target){
    target.metrics.forEach(t=>{
        let targetname = target.name+'_'+t.name;
	let proTarget = prometheustargets.filter(g=>g.job_name==targetname);
	if (proTarget.length != 0){
	    exitargets.remove(targetname);
            customTarget = azure_sd_data;
            customTarget.job_name=targetname;
            if (t.timeout != "" && t.timeout != null){
                customTarget.scrape_timeout=t.timeout;
            }
            if (t.path != "" && t.path != null){
                customTarget.metrics_path=t.path;
            }
            if (t.interval != "" && t.interval != null){
                customTarget.scrape_interval=t.interval;
            }
            if (t.port != "" && t.port != null){
                customTarget.azure_sd_configs[0].port=t.port;
            }
            customTarget.azure_sd_configs[0].tenant_id=tenantId;
            customTarget.azure_sd_configs[0].subscription_id=subscriptionId;
	    //console.log("customTarget",customTarget);
	    //console.log("proTarget",proTarget);
	    let issame=CompareJsonObj(proTarget,customTarget);
	    if (issame != true) {
		isreload = true;
	        replacetarget(targetname,customTarget);
	    }
        }else{
	    isreload = true;
            proTarget = azure_sd_data;
            proTarget.job_name=targetname;
	    if (t.timeout != "" && t.timeout != null){
                proTarget.scrape_timeout=t.timeout;
            }
            if (t.path != "" && t.path != null){
                proTarget.metrics_path=t.path;
            }
            if (t.interval != "" && t.interval != null){
                proTarget.scrape_interval=t.interval;
            }
            if (t.port != "" && t.port != null){
                proTarget.azure_sd_configs[0].port=t.port;
            }
            proTarget.azure_sd_configs[0].tenant_id=tenantId;
            proTarget.azure_sd_configs[0].subscription_id=subscriptionId
            addtarget(proTarget);
        }
    });
}

let updatestatictarget=function(prometheustargets,target){
    target.metrics.forEach(t=>{
        let targetname = target.name+'_'+t.name;
	customtargets.push(targetname);
	let proTarget = prometheustargets.filter(g=>g.job_name==targetname);
        if (proTarget.length != 0){
	    exitargets.remove(targetname);
	    customTarget = static_configs_data;
            customTarget.job_name=targetname;
	    if (t.timeout != "" && t.timeout != null){
                customTarget.scrape_timeout=t.timeout;
            }
            if (t.path != "" && t.path != null){
                customTarget.metrics_path=t.path;
            }
            if (t.interval != "" && t.interval != null){
                customTarget.scrape_interval=t.interval;
            }
	    target.host.forEach(host=>{
	        customTarget.static_configs[0].targets.push(host);
	    });
	    let issame=CompareJsonObj(proTarget,customTarget);
	    if (issame != true) {
                isreload = true;
                replacetarget(targetname,customTarget);
            }
        }else{
	    isreload = true;
            proTarget = static_configs_data;
            proTarget.job_name=targetname;
	    if (t.timeout != "" && t.timeout != null){
                proTarget.scrape_timeout=t.timeout;
            }
            if (t.path != "" && t.path != null){
                proTarget.metrics_path=t.path;
            }
            if (t.interval != "" && t.interval != null){
                proTarget.scrape_interval=t.interval;
            }
            target.host.forEach(host=>{
                proTarget.static_configs[0].targets.push(host);
            });
            //console.log("static proTarget == 0",proTarget);
            addtarget(proTarget);
        }
    });
}


promethues.scrape_configs.forEach(t=>{
    exitargets.push(t.job_name);
});
//console.log("exitargets",exitargets);
merge(input.targets,input.stages[0].targets).forEach(t=>{
    if(t.type == "azure-vm-scale-set" || t.type == "azure-vm-instance"){
        updateazuretarget(promethues.scrape_configs,t);
    }else if (t.type == "static-host"){
	//console.log("static-host");
	updatestatictarget(promethues.scrape_configs,t);
    }
});
//console.log("isreload",isreload);
//console.log("exitargets2",exitargets);
if(exitargets.length > 1){
    promethues.scrape_configs.forEach(t=>{
	//console.log("t.job_name",t.job_name);
        if (t.job_name != "prometheus"){
            removetarget(t.job_name);
	}
    });
}
console.log(isreload);