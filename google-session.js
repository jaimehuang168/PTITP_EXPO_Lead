(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.PtitpGoogleSession=factory().createGoogleSession;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  async function loadGoogleSdk(){
    const [app,auth]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js')
    ]);
    return {...app,...auth};
  }
  function createGoogleSession(options){
    const fetcher=options.fetch||globalThis.fetch.bind(globalThis);
    let sdk,auth,generation=0;
    let state={loading:true,configured:false,user:null,ocr:{activo:false},error:''};
    const getSnapshot=()=>({...state,user:state.user?{...state.user}:null});
    const notify=()=>options.onChange?.(getSnapshot());
    function authError(message='Iniciá sesión con Google para continuar'){
      return Object.assign(new Error(message),{authRequired:true,retryable:false});
    }
    async function request(url,options={}){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
      try{const r=await fetcher(url,{...options,signal:controller.signal});if(r.ok===false)throw new Error('Servicio temporalmente no disponible');return await r.json();}
      finally{clearTimeout(timer);}
    }
    async function verifyUser(user){
      const revision=++generation;
      if(!user){state={...state,user:null,loading:false,error:''};notify();return;}
      try{
        const idToken=await user.getIdToken();
        const result=await request(options.apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({accion:'sesion',idToken})});
        if(revision!==generation||auth.currentUser?.uid!==user.uid)return;
        if(!result.ok||result.usuario?.uid!==user.uid)throw Object.assign(new Error(result.error||'No se pudo verificar la cuenta'),{retryable:result.retryable===true});
        state={...state,user:result.usuario,ocr:result.ocr,loading:false,error:''};notify();
      }catch(error){
        if(revision!==generation)return;
        const cached=state.user?.uid===user.uid&&(error.retryable===true||error instanceof TypeError);
        state={...state,user:cached?state.user:null,loading:false,error:error.message||'No se pudo verificar la sesión'};notify();
      }
    }
    async function start(){
      try{
        const url=new URL(options.apiUrl);url.searchParams.set('action','config');
        const config=await request(url.toString());
        state={...state,configured:config.auth?.configured===true,ocr:config.ocr||{activo:false}};
        if(!state.configured)throw new Error('Inicio de sesión no disponible. Avisá al coordinador.');
        sdk=await(options.loadSdk||loadGoogleSdk)();
        auth=sdk.getAuth(sdk.initializeApp(config.auth.firebase));auth.languageCode='es';
        await sdk.setPersistence(auth,sdk.browserSessionPersistence);
        sdk.onIdTokenChanged(auth,verifyUser);
      }catch(error){state={...state,loading:false,error:error.message||'No se pudo cargar el acceso con Google'};notify();}
    }
    async function signIn(){
      if(!sdk||!auth)throw new Error('Inicio de sesión no disponible. Avisá al coordinador.');
      const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
      const result=await sdk.signInWithPopup(auth,provider);
      await verifyUser(result.user);
    }
    async function signOut(){generation++;state={...state,user:null,error:''};notify();if(auth)await sdk.signOut(auth);}
    function invalidate(){generation++;state={...state,user:null,error:'La sesión venció. Volvé a iniciar sesión con Google.'};notify();}
    async function refresh(){if(auth?.currentUser)await verifyUser(auth.currentUser);}
    async function getIdToken(expectedUid){
      const current=auth?.currentUser;
      if(!current||!state.user||state.user.uid!==current.uid||expectedUid&&expectedUid!==current.uid)throw authError('Iniciá sesión con la cuenta que creó este registro');
      const token=await current.getIdToken();
      if(auth.currentUser?.uid!==current.uid||state.user?.uid!==current.uid)throw authError();
      return token;
    }
    return {start,signIn,signOut,getIdToken,getSnapshot,invalidate,refresh};
  }
  return {createGoogleSession};
});
