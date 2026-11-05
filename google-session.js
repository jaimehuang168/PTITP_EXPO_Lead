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
    let sdk,auth,generation=0,configGeneration=0,requestedId=options.eventId||'';
    let state={loading:true,configured:false,user:null,ocr:{activo:false},error:'',eventLoading:true,eventos:[],eventoSeleccionado:null,eventoDefaultId:'',eventoError:''};
    const getSnapshot=()=>({...state,user:state.user?{...state.user}:null,eventos:state.eventos.map(e=>({...e})),eventoSeleccionado:state.eventoSeleccionado?{...state.eventoSeleccionado}:null,ocr:{...state.ocr}});
    const notify=()=>options.onChange?.(getSnapshot());
    function applyConfig(config){
      state={...state,eventos:Array.isArray(config.eventos)?config.eventos:[],eventoSeleccionado:config.eventoSeleccionado||null,
        eventoDefaultId:config.eventoDefaultId||'',eventoError:config.eventoError||'',ocr:config.ocr||{activo:false},eventLoading:false};
      if(!requestedId)requestedId=state.eventoSeleccionado?.id||state.eventoDefaultId;
    }
    function configUrl(id){const url=new URL(options.apiUrl);url.searchParams.set('action','config');if(id)url.searchParams.set('eventoId',id);return url.toString();}
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
      const configRevision=configGeneration,eventId=requestedId;
      if(!user){state={...state,user:null,loading:false,error:''};notify();return;}
      try{
        const idToken=await user.getIdToken();
        const result=await request(options.apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({accion:'sesion',idToken,eventoId:eventId})});
        if(revision!==generation||auth.currentUser?.uid!==user.uid)return;
        if(!result.ok||result.usuario?.uid!==user.uid)throw Object.assign(new Error(result.error||'No se pudo verificar la cuenta'),{retryable:result.retryable===true});
        if(configRevision===configGeneration&&eventId===requestedId&&!state.eventLoading)applyConfig(result);
        state={...state,user:result.usuario,loading:false,error:''};notify();
      }catch(error){
        if(revision!==generation)return;
        const cached=state.user?.uid===user.uid&&(error.retryable===true||error instanceof TypeError);
        state={...state,user:cached?state.user:null,loading:false,error:error.message||'No se pudo verificar la sesión'};notify();
      }
    }
    async function start(){
      try{
        const config=await request(configUrl(requestedId));
        applyConfig(config);
        state={...state,configured:config.auth?.configured===true};notify();
        if(!state.configured)throw new Error('Inicio de sesión no disponible. Avisá al coordinador.');
        sdk=await(options.loadSdk||loadGoogleSdk)();
        auth=sdk.getAuth(sdk.initializeApp(config.auth.firebase));auth.languageCode='es';
        await sdk.setPersistence(auth,sdk.browserSessionPersistence);
        sdk.onIdTokenChanged(auth,verifyUser);
      }catch(error){state={...state,loading:false,eventLoading:false,error:error.message||'No se pudo cargar el acceso con Google'};notify();}
    }
    async function selectEvent(id){
      const revision=++configGeneration;
      state={...state,eventLoading:true};notify();
      try{
        const config=await request(configUrl(id));
        if(revision!==configGeneration)return false;
        if(!Array.isArray(config.eventos))throw new Error('No se pudo cargar la actividad');
        requestedId=id||config.eventoDefaultId||'';applyConfig(config);state={...state,error:''};notify();
        return !!state.eventoSeleccionado;
      }catch(error){
        if(revision===configGeneration){state={...state,eventLoading:false,error:'No se pudo cambiar la actividad. Conservamos el formulario; reintentá con conexión.'};notify();}
        return false;
      }
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
    return {start,signIn,signOut,getIdToken,getSnapshot,invalidate,refresh,selectEvent,reloadEvents:()=>selectEvent(requestedId)};
  }
  return {createGoogleSession};
});
