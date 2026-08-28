import type { Names, Strings } from './index.ts';

// Spanish. Neutral wording: no gendered forms for people, and no "vosotros" so it reads well in any Spanish.

export function es({ bot, publishCommand }: Names): Strings {
  return {
    // La app de Slack (ver manifest.ts), en el idioma del equipo
    manifestDescription: `Escribe al equipo de ${bot}`,
    publishShortcutName: `Publicar como ${bot}`,
    publishShortcutDescription: `Publica este mensaje como ${bot} en un canal o por mensaje directo`,
    publishCommandDescription: `Publicar como ${bot} en un canal o por mensaje directo`,
    publishCommandHint: '[texto del mensaje]',

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
      `Escribe desde la pestaña *Mensajes* de ${bot}. Lo lee todo el equipo y te responde allí.`,
    homeTeam: (teamChannel, sendEmoji, deleteEmoji) =>
      `*Para el equipo de ${bot}*\n` +
      `• Cada conversación con ${bot} aparece en <#${teamChannel}> como un hilo.\n` +
      `• Para responder, escribe en el hilo y añade :${sendEmoji}: a tu mensaje. ${bot} lo envía y lo marca con :white_check_mark:.\n` +
      `• Para borrar algo que ${bot} envió, añade :${deleteEmoji}: a su mensaje de registro en <#${teamChannel}>.\n` +
      `• Para publicar o escribir a alguien como ${bot}, usa \`${publishCommand}\` o el atajo de mensaje para publicar como ${bot}.`,
  };
}
