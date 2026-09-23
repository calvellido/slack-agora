import type { Names, Strings } from './index.ts';

// Spanish. Neutral wording: no gendered forms for people, and no "vosotros" so it reads well in any Spanish.

export function es({ bot, publishCommand, anonCommand }: Names): Strings {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const days = (count: number) => plural(count, 'día', 'días');

  return {
    // La app de Slack (ver manifest.ts), en el idioma del equipo
    manifestDescription: `Escribe al equipo de ${bot}, con tu nombre o de forma anónima`,
    anonShortcutName: `Mensaje anónimo a ${bot}`,
    anonShortcutDescription: `Escribe al equipo de ${bot} sin tu nombre`,
    publishShortcutName: `Publicar como ${bot}`,
    publishShortcutDescription: `Publica este mensaje como ${bot} en un canal o por mensaje directo`,
    publishCommandDescription: `Publicar como ${bot} en un canal o por mensaje directo`,
    publishCommandHint: '[texto del mensaje]',
    anonCommandDescription: `Escribir al equipo de ${bot} sin tu nombre`,

    // Canal del equipo: hilos de conversación
    dmHeader: (user) => `💬 Mensaje directo de <@${user}>`,
    mentionHeader: (user, channel, permalink) =>
      `🔔 <@${user}> mencionó a ${bot} en <#${channel}> · <${permalink}|ver mensaje>`,
    followUp: (user) => `<@${user}> escribió:`,
    dmStarted: (poster, user) => `📤 <@${poster}> escribió como ${bot} a <@${user}>:`,
    replyHint: (sendEmoji) => `Para responder como ${bot}, escribe en este hilo y añade :${sendEmoji}: a tu mensaje.`,
    filesNotRelayed: (count) =>
      `📎 Incluye ${count === 1 ? 'un archivo' : `${count} archivos`} que ${bot} todavía no puede reenviar.`,

    // Canal del equipo: registro de lo que el bot publicó o borró
    published: (poster, channel, permalink) =>
      `📣 <@${poster}> publicó como ${bot} en <#${channel}> · <${permalink}|ver mensaje>`,
    publishFailed: (poster, target, error) =>
      `⚠️ No se pudo enviar como ${bot} a ${target} (lo pidió <@${poster}>): \`${error}\``,
    deleted: (user) => `🗑️ <@${user}> eliminó lo que ${bot} había enviado.`,

    // Canal del equipo: solo lo ve quien reaccionó
    notInThread: `Solo se pueden enviar como ${bot} los mensajes escritos dentro del hilo de una conversación.`,
    notAConversation: `Este hilo no corresponde a ninguna conversación de ${bot}.`,
    cannotSendBotMessage: `Ese mensaje es de ${bot}. Escribe tu respuesta en el hilo y añade la reacción a tu mensaje.`,
    emptyReply: 'Ese mensaje no tiene texto que enviar.',
    filesNotSent: `Se ha enviado el texto, pero ${bot} todavía no puede enviar archivos.`,
    alreadySent: 'Este mensaje ya se envió.',
    sendFailed: (error) => `No se pudo enviar el mensaje: \`${error}\``,
    alreadyDeleted: 'Ya estaba eliminado.',
    deleteFailed: (error) => `No se pudo eliminar: \`${error}\``,

    // Mensaje directo a quien escribe al bot
    dmAck: `¡Gracias por escribir! El equipo de ${bot} ha recibido tu mensaje y te responderá por aquí.`,

    // Publicar como el bot
    teamOnly: `Esto solo está disponible para el equipo de ${bot}.`,
    publishTitle: `Publicar como ${bot}`,
    publishSubmit: 'Publicar',
    publishClose: 'Cancelar',
    publishChannel: 'Canal',
    publishPeople: 'Personas (mensaje directo)',
    publishMessage: 'Mensaje',
    publishHint: (teamChannel) =>
      `Elige un canal, personas o ambos. En <#${teamChannel}> quedará registro de quién lo publicó.`,
    publishNeedTarget: 'Elige un canal o al menos una persona.',
    publishEmpty: 'El mensaje está vacío.',
    publishNotMember: `${bot} no está en este canal privado. Primero invita a ${bot} con /invite @${bot}.`,
    publishArchived: 'Este canal está archivado.',

    // Pestaña Inicio
    homeContact:
      `*¿Quieres hablar con el equipo de ${bot}?*\n` +
      `• *Con tu nombre:* escribe desde la pestaña *Mensajes* de ${bot}. El equipo ve quién eres y te responde allí.\n` +
      '• *Sin tu nombre:* abre *Mensajes anónimos*. Ahí escribes al equipo y lees sus respuestas.',
    homeAnonButton: 'Mensajes anónimos',
    homeAnonHint:
      'Tus conversaciones anónimas nunca aparecen en esta pestaña, solo en esa ventana. ' +
      `También puedes abrirla con \`${anonCommand}\` desde cualquier canal.`,
    homeTeam: (teamChannel, sendEmoji, deleteEmoji) =>
      `*Para el equipo de ${bot}*\n` +
      `• Cada conversación con ${bot} aparece en <#${teamChannel}> como un hilo, también las anónimas.\n` +
      `• Para responder, escribe en el hilo y añade :${sendEmoji}: a tu mensaje. ${bot} lo envía y lo marca con :white_check_mark:.\n` +
      `• Para borrar algo que ${bot} envió, añade :${deleteEmoji}: a su mensaje de registro en <#${teamChannel}>.\n` +
      `• Para publicar o escribir a alguien como ${bot}, usa \`${publishCommand}\` o el atajo de mensaje para publicar como ${bot}.`,

    // Ventana "Mensajes anónimos": las conversaciones anónimas de quien la abre
    inboxTitle: 'Mensajes anónimos',
    inboxIntro:
      `Escribe al equipo de ${bot} sin tu nombre. El equipo recibe tus mensajes como anónimos, ` +
      'y sus respuestas aparecen aquí, en esta ventana. No quedan en tus mensajes de Slack.',
    inboxNew: 'Nueva conversación',
    inboxEmpty: 'No tienes conversaciones anónimas.',
    inboxConversations: '*Tus conversaciones*',
    inboxOpen: 'Abrir',
    inboxNewReply: '🆕 Respuesta nueva',
    inboxStarted: (date) => `Empezó: ${date}`,
    inboxLast: (date) => `Último mensaje: ${date}`,
    convName: '*Conversación anónima*',
    convTitle: 'Conversación anónima',
    convEndedByTeam: (count) => `🔒 Terminada por el equipo. Desaparecerá de aquí en ${days(count)}.`,
    convExpired: (count) => `🔒 Terminada por inactividad. Desaparecerá de aquí en ${days(count)}.`,
    convYou: '🕶️ *Tú*',
    convNew: '🆕',
    convHidden: (count) => `${plural(count, 'mensaje anterior', 'mensajes anteriores')} sin mostrar.`,
    convUnavailable: '_Este mensaje ya no está disponible._',
    convReply: 'Tu respuesta',
    convSend: 'Enviar',
    convBack: 'Volver',
    convEnd: 'Terminar conversación',
    convDelete: 'Borrar conversación',
    convDeleteConfirmTitle: '¿Borrar la conversación?',
    convDeleteConfirm: `${bot} borrará tus mensajes del canal del equipo y olvidará que esta conversación es tuya.`,
    convDeleteConfirmButton: 'Borrar',
    convDeleted: `${bot} está borrando tus mensajes del canal del equipo y ya no guarda nada que te relacione con la conversación.`,
    cancel: 'Cancelar',

    // Terminar una conversación, desde la ventana
    endIntro: `Al terminarla, nadie podrá escribir más en ella y ${bot} olvidará que es tuya, así que no podrás volver a verla.`,
    endDeleteLabel: 'Tus mensajes',
    endDeleteOption: 'Borrar también mis mensajes del canal del equipo',
    endDeleteHint:
      'El equipo dejará de ver lo que escribiste. Sus respuestas seguirán en el canal, salvo que cada persona del equipo borre las suyas.',
    endSubmit: 'Terminar',
    endDone: `Has terminado la conversación. ${bot} ya no guarda nada que te relacione con ella.`,
    endDoneDeleted:
      `Has terminado la conversación y ${bot} está borrando tus mensajes del canal del equipo. ` +
      'Ya no guarda nada que te relacione con ella.',

    // Formulario de nueva conversación anónima
    anonTitle: 'Mensaje anónimo',
    anonSubmit: 'Enviar',
    anonIntro:
      `El equipo de ${bot} recibirá tu mensaje como anónimo, sin tu nombre. ` +
      `Las respuestas aparecerán en *Mensajes anónimos* de ${bot}, y desde allí podrás seguir la conversación.`,
    anonMessage: 'Mensaje',
    anonPrivacy:
      '• Lo que cuentes y tu forma de escribir pueden identificarte: piensa qué detalles incluyes.\n' +
      '• El equipo no puede saber si dos conversaciones anónimas son de la misma persona.\n' +
      `• ${bot} no te avisa cuando hay respuesta, porque un aviso dejaría rastro en tus mensajes. Vuelve aquí para verla.\n` +
      `• ${bot} no guarda tu nombre con el mensaje, solo una huella cifrada para enseñarte las respuestas. ` +
      'Se borra al terminar la conversación, y entonces también puedes borrar tus mensajes del canal del equipo.',
    anonSent: `✅ Enviado. El equipo lo recibirá sin tu nombre.\n\nSus respuestas aparecerán en *Mensajes anónimos* de ${bot}.`,
    anonClose: 'Cerrar',
    anonEmpty: 'El mensaje está vacío.',
    anonTooMany: (max) =>
      `Ya tienes ${plural(max, 'conversación anónima abierta', 'conversaciones anónimas abiertas')}. ` +
      'Termina alguna para empezar otra.',
    anonUnavailable: 'Esta conversación ya ha terminado.',
    anonSendFailed: 'No se ha podido enviar. Inténtalo de nuevo en unos minutos.',

    // Canal del equipo: hilos anónimos
    anonHeader: '🕶️ *Mensaje anónimo*',
    anonFollowUp: '🕶️ La persona escribió:',
    anonOpenStatus: (sendEmoji) =>
      `Para responder, escribe en el hilo y añade :${sendEmoji}: a tu mensaje. ` +
      `La persona lo verá en *Mensajes anónimos* de ${bot}, también si lo editas después.`,
    anonEndButton: 'Terminar conversación',
    anonEndConfirmTitle: '¿Terminar la conversación?',
    anonEndConfirm: (count) =>
      `La persona ya no podrá escribir en ella, y la verá como terminada durante ${days(count)}.`,
    anonEndConfirmButton: 'Terminar',
    anonEndedBy: (user) => `🔒 <@${user}> terminó la conversación.`,
    anonEndedByPerson: '🔒 La persona terminó la conversación.',
    anonEndedByTeam: '🔒 El equipo terminó la conversación.',
    anonExpired: (count) => `🔒 Conversación terminada automáticamente tras ${days(count)} sin actividad.`,
    anonDeletableStatus: `La persona ya no puede ver esta conversación. ${bot} puede borrar del canal todo lo que publicó en ella.`,
    anonDeleteButton: 'Borrar conversación',
    anonDeleteConfirmTitle: '¿Borrar la conversación?',
    anonDeleteConfirm:
      `${bot} borrará lo que publicó en este hilo, también los mensajes de la persona. ` +
      'Las respuestas del equipo solo puede borrarlas quien las escribió.',
    anonDeleteConfirmButton: 'Borrar',
    anonDeletedByTeam: 'Borrado. Las respuestas del equipo que queden en el hilo solo puede borrarlas quien las escribió.',
    anonDeletedByPerson:
      '🗑️ La persona borró sus mensajes de esta conversación. Las respuestas del equipo solo puede borrarlas quien las escribió.',
    anonNotDeletable: 'La persona todavía puede ver esta conversación, así que aún no se puede borrar.',
    anonReplyClosed: 'Esta conversación anónima ha terminado.',
    anonAlreadyClosed: 'Esta conversación ya había terminado.',
    anonReplyDeleted: (user) =>
      `🗑️ <@${user}> retiró la respuesta. La persona ya no la verá, aunque puede que ya la haya leído.`,
  };
}
