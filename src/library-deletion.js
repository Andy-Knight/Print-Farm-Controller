import {getLibraryFile,removeLibraryFile} from './print-library.js';

// The caller holds the controller's library-queue mutation lock. Persist recent
// history removal first, then reporting removal, and remove the stored file last.
// A failed cleanup leaves the file available for a safe retry.
export async function deleteLibraryFileAndHistory(fileId,{
  queue,reporting,getFile=getLibraryFile,removeFile=removeLibraryFile
}){
  const file=await getFile(fileId);fileId=file.id;
  const recent=await queue.removeLibraryHistory(fileId);
  let archived;
  try{archived=await reporting.removeLibraryHistory(fileId);}
  catch(error){
    throw new Error('Could not finish removing linked print history. The library file was kept; retry the deletion.',{cause:error});
  }
  try{await removeFile(fileId);}
  catch(error){
    throw new Error('Linked print history was removed, but the library file could not be deleted. Retry the deletion.',{cause:error});
  }
  return {recent,reporting:archived};
}
