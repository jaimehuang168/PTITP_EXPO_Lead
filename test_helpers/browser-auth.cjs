// Simulates only the external Google SDK and session endpoint; app/session code stays real.
const user=(uid='operator-uid',email='operator@gmail.com',displayName='María González')=>({uid,email,displayName,getIdToken:async()=> 'firebase-fixture-'+uid});
function installBrowserAuth(w,{signedIn=true,admin=true,ocrActive=true}={}){
  const auth={currentUser:signedIn?user('operator-uid',admin?'jaimehuang168@gmail.com':'operator@gmail.com'):null,languageCode:''};
  let listener=()=>{},nextUser=user();
  const sdk={initializeApp:()=>({}),getAuth:()=>auth,setPersistence:async()=>{},browserSessionPersistence:'session',
    GoogleAuthProvider:class{setCustomParameters(){}},
    onIdTokenChanged:(a,cb)=>{listener=cb;queueMicrotask(()=>cb(auth.currentUser));return()=>{};},
    signInWithPopup:async()=>{auth.currentUser=nextUser;listener(nextUser);return{user:nextUser};},
    signOut:async()=>{auth.currentUser=null;listener(null);}
  };
  const authFetch=async(url,options)=>({ok:true,json:async()=>{
    if(!options?.body)return{ok:true,auth:{configured:true,firebase:{apiKey:'public-fixture',projectId:'ptitp-expo-registro',authDomain:'ptitp-expo-registro.firebaseapp.com'}},ocr:{activo:ocrActive,desde:'2026-11-10',hasta:'2026-11-14',zona:'America/Asuncion'}};
    const u=auth.currentUser;return u?{ok:true,usuario:{uid:u.uid,email:u.email,nombre:u.displayName,admin:u.email==='jaimehuang168@gmail.com'},ocr:{activo:ocrActive}}:{ok:false,authRequired:true,error:'Iniciá sesión'};
  }});
  w.PtitpGoogleSession=options=>require('../google-session.js').createGoogleSession({...options,loadSdk:async()=>sdk,fetch:authFetch});
  w.scrollTo=()=>{};
  return{setUser(u){auth.currentUser=u;listener(u);},nextLogin(u){nextUser=u;},user,auth};
}
module.exports={installBrowserAuth,user};
