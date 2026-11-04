function installGasAuth(target,{uid='fixture-google-uid',email='jaimehuang168@gmail.com',name='María González',activeOcr=false}={}){
  const now=Math.floor((target.Date||Date).now()/1000);
  const claims={aud:'ptitp-expo-registro',iss:'https://securetoken.google.com/ptitp-expo-registro',sub:uid,email,email_verified:true,iat:now-10,auth_time:now-10,exp:now+3600,firebase:{sign_in_provider:'google.com'}};
  const idToken=[{alg:'RS256',kid:'fixture'},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.fixture-signature';
  const props=target.PropertiesService;
  target.PropertiesService={getScriptProperties(){const original=props?.getScriptProperties()||{};return{...original,getProperty:k=>k==='FIREBASE_PROJECT_ID'?'ptitp-expo-registro':k==='FIREBASE_WEB_API_KEY'?'public-fixture-api-key':original.getProperty?.(k)||''};}};
  const utilities=target.Utilities||{},originalBlob=utilities.newBlob;
  target.Utilities={...utilities,base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob(...args){const blob=originalBlob?originalBlob(...args):{};blob.getDataAsString=()=>Buffer.from(args[0]).toString();return blob;}};
  if(activeOcr){const format=target.Utilities.formatDate;target.Utilities.formatDate=(date,tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-11-11':format(date,tz,fmt);}
  const externalFetch=target.UrlFetchApp?.fetch;
  target.UrlFetchApp={fetch(url,options){if(url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='))return{getResponseCode:()=>JSON.parse(options.payload).idToken===idToken?200:400,getContentText:()=>JSON.stringify({users:[{localId:uid,email,emailVerified:true,displayName:name,disabled:false,validSince:'0',providerUserInfo:[{providerId:'google.com',email}]}]})};if(!externalFetch)throw new Error('Unexpected external request');return externalFetch(url,options);}};
  return idToken;
}
function withIdentity(post,idToken){return e=>{try{const data=JSON.parse(e.postData.contents);if(data&&typeof data==='object'&&!Array.isArray(data)&&!Object.prototype.hasOwnProperty.call(data,'idToken'))data.idToken=idToken;return post({...e,postData:{...e.postData,contents:JSON.stringify(data)}});}catch{ return post(e);}};}
module.exports={installGasAuth,withIdentity};
