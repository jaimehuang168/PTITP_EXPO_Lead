const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const {installGasAuth}=require('./test_helpers/gas-auth.cjs');
const backend=fs.readFileSync('Code.gs','utf8');
const template=fs.readFileSync('CustomerReport.html','utf8');
const utilities={formatDate:(date,zone,pattern)=>pattern==='yyyy-MM-dd'?date.toISOString().slice(0,10):'17/11/2026 12:00'};
function fixture(){
 return {
  pipeline:[
   {fila:2,datos:{LeadID:'L-one',Empresa:'Empresa Á','Nombre':'Contacto','Email':'cliente@example.invalid','Evento':'EXPO PBW','Etapa':'Nuevo','Intereses':'Terreno','Superficie (m²)':'500'}},
   {fila:3,datos:{LeadID:'L-two',Empresa:'Empresa Á','Nombre':'Contacto','Email':'cliente@example.invalid','Evento':'PBW 2026','Etapa':'Nuevo','Notas':'Importado de Registro de Visitas. Fuente: https://docs.google.com/spreadsheets/d/test-visitas-sheet/edit#gid=7&range=A2:AJ2; fila: 2;'}},
   {fila:4,datos:{LeadID:'L-three',Empresa:'Otra empresa','Nombre':'Otro','Email':'cliente@example.invalid','Evento':'Otro evento','Etapa':'Nuevo'}}
  ],
  leads:[{fila:2,datos:{LeadID:'L-one',Empresa:'Empresa Á',Evento:'EXPO PBW',Timestamp:'2026-11-11','Cómo nos conoció':'Referido','Sector/Rubro':'Manufactura'}}],
  controles:[{fila:2,datos:{LeadID:'L-one','Preparar Gantt':'Listo para Gantt','Necesidad confirmada':'Terreno','Superficie confirmada':'500',Unidad:'m²','Próxima acción':'Confirmar potencia'}}],
  correos:[
   {fila:2,datos:{LeadID:'L-one',Tipo:'Invitación',Fecha:'2026-11-06',Evidencia:'https://mail.google.com/mail/u/0/#all/invite'}},
   {fila:3,datos:{LeadID:'L-one',Tipo:'Respuesta visita',Fecha:'2026-11-13',Evidencia:'https://mail.google.com/mail/u/0/#all/visit'}}
  ],
  visitas:[{fila:2,datos:{Timestamp:'2026-11-11','Superficie estimada requerida (m² o ha) | Área estimada necessária (m² ou ha)':'650'}}],
  crmUrl:'https://docs.google.com/spreadsheets/d/test-crm-customer-sheet/edit',pipelineGid:1,controlGid:2,
  expoUrl:'https://docs.google.com/spreadsheets/d/test-expo-customer-sheet/edit',leadsGid:3,
  hoy:'2026-11-17',generado:'17/11/2026 12:00',fechaRevision:'2026-11-17',cuentas:'cuenta de prueba'
 };
}
const context=vm.createContext({console,Date,Utilities:utilities});
vm.runInContext(backend,context);
const input=fixture();
let result=context._construirClientes(input);
assert.equal(result.estadisticas.clientes,2);
assert.equal(result.totalRegistros,3);
assert.equal(result.clientes.find(c=>c.id==='L-one').registros.length,2);
let client=result.clientes.find(c=>c.id==='L-one');
assert.equal(client.primerCorreo.estado,'Sin evidencia');
assert.equal(client.respuesta.estado,'Sin evidencia');
assert.equal(client.listoGantt,false);
assert.equal(client.declaraciones[1].unidad,'Unidad por confirmar');
assert.equal(client.fuentes[0].canal,'Referido');
assert.equal(client.fuentes[1].nombre,'Formulario de visita · PBW 2026');

input.correos.push({fila:4,datos:{LeadID:'L-one',Tipo:'Seguimiento inicial',Fecha:'2026-11-14T13:00:00Z',Evidencia:'https://mail.google.com/mail/u/0/#all/first',Resumen:'Dossier enviado'}});
input.correos.push({fila:5,datos:{LeadID:'L-one',Tipo:'Respuesta comercial',Fecha:'2026-11-16T13:00:00Z',Evidencia:'https://mail.google.com/mail/u/0/#all/reply',Resumen:'Confirma necesidad de terreno'}});
result=context._construirClientes(input);
client=result.clientes.find(c=>c.id==='L-one');
assert.equal(client.primerCorreo.estado,'Verificado');
assert.equal(client.respuesta.estado,'Verificado');
assert.equal(client.superficieConfirmada,'500 m²');
assert.equal(client.listoGantt,true);
assert.equal(client.idGantt,'CRM-L-one');
input.pipeline.reverse();
assert.equal(context._construirClientes(input).clientes.find(c=>c.empresa==='Empresa Á').idGantt,'CRM-L-one');
input.pipeline.reverse();
assert.equal(result.estadisticas.necesidades,1);
input.controles.push({fila:4,datos:{LeadID:'L-one','Preparar Gantt':'Listo para Gantt'}});
assert.equal(context._construirClientes(input).clientes.find(c=>c.id==='L-one').listoGantt,false);
input.controles.pop();

const differentChinese=fixture();
differentChinese.pipeline[0].datos.Empresa='甲公司';
differentChinese.pipeline[1].datos.Empresa='乙公司';
assert.equal(context._construirClientes(differentChinese).clientes.length,3);
const missingCRM=fixture();
missingCRM.leads.push({fila:3,datos:{LeadID:'L-new',Empresa:'Nueva empresa',Evento:'EXPO PBW'}});
assert.equal(context._construirClientes(missingCRM).clientes.find(c=>c.id==='L-new').etapa,'Pendiente de sincronizar');

let privateReads=0;
const authTarget={Date,Utilities:utilities,
 ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return{text,setMimeType(){return this;}}}},
 SpreadsheetApp:{getActiveSpreadsheet(){privateReads++;throw Error('Private read');}}
};
const staffToken=installGasAuth(authTarget,{email:'staff@example.invalid'});
const auth=vm.createContext(authTarget);
vm.runInContext(backend,auth);
assert.equal(auth.actualizarReporteClientes(undefined).ok,false);
assert.equal(auth.actualizarReporteClientes(staffToken).ok,false);
assert.equal(privateReads,0);

async function browser(){
 const payload=JSON.stringify(result).replace(/</g,'\\u003c');
 const html=template.replace('<?!= reportJson ?>',payload).replace('<?!= sessionJson ?>','{"idToken":"fixture-token"}');
 const errors=[],downloads=[];
 const virtualConsole=new VirtualConsole();
 virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{
  runScripts:'dangerously',url:'https://example.invalid/',virtualConsole,
  beforeParse(window){
   window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
   window.HTMLDialogElement.prototype.close=function(){this.open=false;};
   window.print=()=>{};
   window.Blob=Blob;
   window.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:fixture';};
   window.URL.revokeObjectURL=()=>{};
   window.HTMLAnchorElement.prototype.click=function(){};
  }
 });
 const {window}=dom,document=window.document,$=id=>document.getElementById(id);
 assert.equal(errors.length,0,errors.join('\n'));
 assert.equal($('report-session'),null);
 assert.equal(document.querySelectorAll('#customers tr').length,2);
 $('search').value='empresa a';$('search').dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(document.querySelectorAll('#customers tr').length,1);
 document.querySelector('.detail-button').click();
 assert.equal($('detail').open,true);
 assert.match($('detail-body').textContent,/Referido/);
 assert.match($('detail-body').textContent,/500 m²/);
 $('gantt-csv').click();
 assert.equal(downloads.length,1);
 const csv=await downloads[0].text();
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const parse=line=>line.match(/(".*?"|[^,]+)/g).map(s=>s.replace(/^"|"$/g,'').trim());
 assert.deepEqual(parse(lines[0]),['id','company','status','firstContact','country','industry','needs','progress','action','updated']);
 assert.equal(parse(lines[1]).length,10);
 assert.equal(parse(lines[1])[0],'CRM-L-one');
 assert.match(parse(lines[1])[7],/LeadID L-one \/ L-two/);
 $('csv').click();
 assert.equal(downloads.length,2);
 const all=await downloads[1].text();
 assert.match(all,/Evidencia primer correo/);
 window.close();
}
browser().then(()=>console.log('PASS complete customer provenance, mail evidence, Gantt eligibility, CSV and administrator access')).catch(error=>{console.error(error);process.exitCode=1;});
