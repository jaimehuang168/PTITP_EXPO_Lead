// Simulates only the external Google SDK and session endpoint; app/session code stays real.
const user=(uid='operator-uid',email='operator@gmail.com',displayName='María González')=>({uid,email,displayName,getIdToken:async()=> 'firebase-fixture-'+uid});
function installBrowserAuth(w,{signedIn=true,admin=true,ocrActive=true,eventos}={}){
  if(!w.PtitpEvents)w.eval(require('node:fs').readFileSync(require('node:path').join(__dirname,'../event-ui.js'),'utf8'));
  const catalog=eventos||[{id:'pbw-2026',nombre:'EXPO PBW',desde:'2026-11-10',hasta:'2026-11-14',visible:true,ocrHabilitado:true,ocrDesde:'2026-11-06',ocrHasta:'2026-11-14',revision:1},{id:'expo-paraguay-2026',nombre:'Expo Paraguay 2026',desde:'',hasta:'',visible:true,ocrHabilitado:false,ocrDesde:'',ocrHasta:'',revision:1}];
  const config=id=>{const e=catalog.find(e=>e.id===(id||'pbw-2026')&&e.visible);return{eventos:catalog,eventoSeleccionado:e||null,eventoDefaultId:'pbw-2026',eventoError:e?'':'Actividad no disponible',evento:e?.nombre||'',desde:e?.desde||'',hasta:e?.hasta||'',ocr:{activo:!!e&&ocrActive&&e.ocrHabilitado,desde:e?.ocrDesde||'',hasta:e?.ocrHasta||'',zona:'America/Asuncion',limiteDiario:300}};};
  const auth={currentUser:signedIn?user('operator-uid',admin?'jaimehuang168@gmail.com':'operator@gmail.com'):null,languageCode:''};
  let listener=()=>{},nextUser=user(),popupCalls=0;
  const sdk={initializeApp:()=>({}),getAuth:()=>auth,setPersistence:async()=>{},browserSessionPersistence:'session',
    GoogleAuthProvider:class{setCustomParameters(){}},
    onIdTokenChanged:(a,cb)=>{listener=cb;queueMicrotask(()=>cb(auth.currentUser));return()=>{};},
    signInWithPopup:async()=>{popupCalls++;auth.currentUser=nextUser;listener(nextUser);return{user:nextUser};},
    signOut:async()=>{auth.currentUser=null;listener(null);}
  };
  const authFetch=async(url,options)=>({ok:true,json:async()=>{
    if(!options?.body)return{ok:true,auth:{configured:true,firebase:{apiKey:'public-fixture',projectId:'ptitp-expo-registro',authDomain:'ptitp-expo-registro.firebaseapp.com'}},...config(new URL(url).searchParams.get('eventoId'))};
    const u=auth.currentUser;return u?{ok:true,usuario:{uid:u.uid,email:u.email,nombre:u.displayName,admin:u.email==='jaimehuang168@gmail.com'},...config(JSON.parse(options.body).eventoId)}:{ok:false,authRequired:true,error:'Iniciá sesión'};
  }});
  w.PtitpGoogleSession=options=>require('../google-session.js').createGoogleSession({...options,loadSdk:async()=>sdk,fetch:authFetch});
  w.scrollTo=()=>{};
  return{setUser(u){auth.currentUser=u;listener(u);},nextLogin(u){nextUser=u;},get popupCalls(){return popupCalls;},user,auth};
}
module.exports={installBrowserAuth,user};
