const MiB=1024**2,GiB=1024**3;
const field=(key,label,group,defaultValue,unit='count')=>Object.freeze({
  key,label,group,defaultValue,unit,scale:unit==='MiB'?MiB:unit==='GiB'?GiB:unit==='seconds'?1000:1,
  min:1,max:unit==='seconds'?86400000:Number.MAX_SAFE_INTEGER
});

// Host policy only: clients may edit these through the administrator API.
// File-format, parser and licensing boundaries are deliberately independent.
export const RESOURCE_LIMIT_FIELDS=Object.freeze([
  field('PFC_MAX_UPLOADS','Concurrent uploads','Uploads',4),
  field('PFC_MAX_UPLOADS_PER_USER','Concurrent uploads per account','Uploads',2),
  field('PFC_MAX_STAGED_UPLOAD_BYTES','Combined staged upload reservations','Uploads',GiB,'MiB'),
  field('PFC_MIN_FREE_DISK_BYTES','Minimum free disk reserve','Storage',512*MiB,'MiB'),
  field('PFC_LIBRARY_MAX_BYTES','Total Print Library storage','Storage',50*GiB,'GiB'),
  field('PFC_LIBRARY_MAX_FILES','Print Library items','Storage',10000),
  field('PFC_LIBRARY_MAX_USER_BYTES','Library file storage per account','Storage',10*GiB,'GiB'),
  field('PFC_MAX_SESSIONS','Total login sessions','Sessions and streams',1000),
  field('PFC_MAX_SESSIONS_PER_USER','Login sessions per account','Sessions and streams',20),
  field('PFC_MAX_STREAMS','Total camera and event connections','Sessions and streams',128),
  field('PFC_MAX_STREAMS_PER_USER','Connections per account','Sessions and streams',16),
  field('PFC_MAX_STREAMS_PER_SESSION','Connections per login session','Sessions and streams',8),
  field('PFC_MAX_STREAMS_PER_IP','Connections per source IP','Sessions and streams',32),
  field('PFC_BACKUP_MAX_EXPANDED_BYTES','Total expanded backup contents','Backup processing',64*GiB,'GiB'),
  field('PFC_BACKUP_MAX_ENTRY_BYTES','Expanded backup entry','Backup processing',GiB,'GiB'),
  field('PFC_UPLOAD_TIMEOUT_MS','Print upload deadline','Timeouts',600000,'seconds'),
  field('PFC_UPLOAD_IDLE_TIMEOUT_MS','Print upload inactivity','Timeouts',30000,'seconds'),
  field('PFC_BACKUP_ARCHIVE_TIMEOUT_MS','Archive processing deadline','Timeouts',600000,'seconds'),
  field('PFC_BACKUP_ENTRY_TIMEOUT_MS','Backup entry processing deadline','Timeouts',120000,'seconds'),
  field('PFC_CLOUD_OPERATION_TIMEOUT_MS','Cloud operation deadline','Timeouts',900000,'seconds'),
  field('PFC_CLOUD_HEADER_TIMEOUT_MS','Cloud response header deadline','Timeouts',30000,'seconds'),
  field('PFC_CLOUD_IDLE_TIMEOUT_MS','Cloud response inactivity','Timeouts',30000,'seconds')
]);

export function validateResourceOverrides(value){
  const invalid=message=>{throw Object.assign(new Error(message),{statusCode:400});};
  if(!value||typeof value!=='object'||Array.isArray(value))invalid('Resource overrides must be an object.');
  const result={};
  for(const [key,number] of Object.entries(value)){
    const definition=RESOURCE_LIMIT_FIELDS.find(field=>field.key===key);
    if(!definition)invalid('Unknown resource limit: '+key);
    if(!Number.isSafeInteger(number)||number<definition.min||number>definition.max)
      invalid(definition.label+' must be a positive whole number in base units; timeouts cannot exceed 24 hours.');
    result[key]=number;
  }
  return result;
}
