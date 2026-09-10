/**
 * El catálogo de la guía: lo que la plataforma es y cómo se usa.
 *
 * Es material de producto escrito a mano, y eso es una decisión, no una deuda.
 * Generar esta ayuda desde el código produciría una descripción de ficheros; lo
 * que alguien necesita cuando entra por primera vez es el porqué de los cuatro
 * niveles y en qué orden se hacen las cosas, que no está en ninguna firma de
 * función.
 *
 * Regla de mantenimiento: **si una pantalla cambia de sitio o de nombre, este
 * fichero cambia en el mismo commit**. Una guía desfasada es peor que ninguna,
 * porque manda al usuario a un botón que ya no existe y le hace dudar de todo
 * lo demás. El reparto de agentes no se escribe aquí por eso mismo: se compone
 * en `services/architectureOffice/application/platformGuidance` a partir del
 * registro real, para que no pueda desfasarse.
 */

import type { PlatformGuideTopic } from './platformGuideContracts';

const topic = (value: PlatformGuideTopic): PlatformGuideTopic => Object.freeze({
  ...value,
  keywords: Object.freeze([...value.keywords]) as string[],
});

export const PLATFORM_GUIDE_TOPICS: readonly PlatformGuideTopic[] = Object.freeze([
  topic({
    id: 'niveles',
    question: '¿Cómo se organiza el trabajo en la plataforma?',
    answer: 'En cuatro niveles encajados. Una **Iniciativa de Negocio** es la necesidad: lo que el negocio quiere conseguir. Un **Proyecto de Arquitectura** es la respuesta de arquitectura a esa necesidad. Una **Solicitud de Entregable** es una unidad de trabajo gobernada que la Oficina planifica y revisa. Y un **Artefacto** es cada documento o diagrama que se produce. Cada nivel se crea desde el de arriba, arrastrando su contexto.',
    where: 'Raíl izquierdo: Iniciativas → Proyectos → Entregables.',
    // Sin los nombres de los cuatro niveles a propósito: cada uno tiene su
    // propio tema, y repetirlos aquí hacía que este ganara siempre y que
    // «¿cómo pido un entregable?» devolviera la explicación de la jerarquía.
    keywords: ['niveles', 'jerarquia', 'organiza', 'estructura', 'relacion', 'encajan', 'empezar', 'orden'],
  }),
  topic({
    id: 'iniciativa',
    question: '¿Qué es una Iniciativa de Negocio y para qué sirve?',
    answer: 'Es la razón por la que existe el trabajo de arquitectura: la necesidad del negocio, su driver, sus objetivos y los resultados que se van a medir. No es un proyecto y no termina cuando se entrega: sigue abierta mientras se estén midiendo sus resultados. Una iniciativa puede estar servida por varios proyectos de arquitectura.',
    where: 'Iniciativas → Nueva iniciativa.',
    keywords: ['iniciativa', 'negocio', 'necesidad', 'driver', 'objetivo', 'kpi', 'indicador', 'resultado'],
  }),
  topic({
    id: 'proyecto',
    question: '¿Qué es un Proyecto de Arquitectura?',
    answer: 'Es cómo la arquitectura responde a una iniciativa: su alcance, su contexto técnico, su líder, sus fechas y sus artefactos. No puede existir sin iniciativa —al crearlo se te pide una— porque un proyecto sin razón de negocio es trabajo que nadie sabe justificar.',
    where: 'Proyectos → Nuevo proyecto, o desde la sala de una iniciativa.',
    keywords: ['proyecto', 'arquitectura', 'atencion', 'alcance', 'contexto'],
  }),
  topic({
    id: 'entregable',
    question: '¿Qué es una Solicitud de Entregable y cómo se pide?',
    answer: 'Es una unidad de trabajo que la Oficina gobierna de principio a fin: recibe el encargo, planifica un charter con las tareas, asigna especialistas, aplica sus puertas de calidad y lo lleva al comité cuando hace falta. Se pide desde el proyecto que la necesita, y hay que aprobar el charter antes de que se ejecute: ejecutar primero y aprobar después convertiría la aprobación en papeleo.',
    where: 'Entregables → Nueva solicitud, o desde el proyecto.',
    keywords: ['entregable', 'solicitud', 'encargo', 'charter', 'oficina', 'pedir', 'tareas'],
  }),
  topic({
    id: 'artefacto',
    question: '¿Cómo se crea un artefacto?',
    answer: 'Desde el proyecto, en su espacio de trabajo: eliges el tipo de artefacto del catálogo —diagramas C4, secuencias, documentos, especificaciones SDD— y la Oficina lo genera con el contexto del proyecto. Después se edita, se valida contra su contrato y se puede exportar o publicar.',
    where: 'Proyectos → abre un proyecto → Mis artefactos / Catálogo.',
    keywords: ['artefacto', 'crear', 'generar', 'diagrama', 'documento', 'c4', 'plantilla', 'catalogo'],
  }),
  topic({
    id: 'diagramas',
    question: '¿Cómo funcionan los diagramas?',
    answer: 'El modelo produce el contenido del diagrama, nunca su distribución: la plataforma lo convierte a una representación interna y coloca las cajas con un motor determinista. Por eso el mismo diagrama se ve igual cada vez y se puede exportar a distintos formatos sin volver a pedírselo al modelo.',
    where: 'Dentro de un artefacto de diagrama, en el lienzo.',
    keywords: ['diagrama', 'mermaid', 'c4', 'lienzo', 'layout', 'excalidraw', 'lucid', 'exportar'],
  }),
  topic({
    id: 'oficina',
    question: '¿Qué es la Oficina de Arquitectura?',
    answer: 'Es el equipo de agentes que atiende cada solicitud. No responde un agente suelto: la petición entra por la coordinadora, se reparte entre los especialistas cuyos dominios toca y se consolida en una única recomendación firmada. El panel de coordinación muestra ese reparto según ocurre, no una animación inventada.',
    where: 'Botón del asistente en la iniciativa, el proyecto o el entregable.',
    keywords: ['oficina', 'equipo', 'coordinacion', 'especialistas', 'consolidar', 'recomendacion'],
  }),
  topic({
    id: 'agentes',
    question: '¿Cuántos agentes hay y qué hace cada uno?',
    answer: 'La Oficina tiene un reparto fijo de arquitectos especialistas, cada uno con su dominio, los artefactos que puede producir y los que puede revisar. En la pantalla de Agentes están todos: abre la ficha de cualquiera para ver su descripción, sus habilidades, el conocimiento de tu organización que le has añadido, lo que recuerda entre encargos y con qué modelo trabaja.',
    where: 'Raíl izquierdo → Agentes.',
    keywords: ['agentes', 'cuantos', 'arquitectos', 'especialistas', 'ficha', 'reparto', 'personas'],
  }),
  topic({
    id: 'configurar-agente',
    question: '¿Puedo cambiar cómo trabaja un agente?',
    answer: 'Sí, en su ficha: nombre, avatar, instrucción, habilidades, conocimiento de tu organización, memoria, modelo y cuántas tareas acepta a la vez. Lo que añades se suma a lo que el agente ya sabe, nunca lo sustituye. Lo que no se configura es su papel en la orquestación ni qué artefactos produce y revisa: eso es gobierno, y un agente que produjera y revisara lo mismo apagaría la revisión.',
    where: 'Agentes → abre una ficha → Configurar.',
    keywords: ['configurar', 'personalizar', 'agente', 'memoria', 'conocimiento', 'modelo', 'avatar', 'instruccion'],
  }),
  topic({
    id: 'asistente-campos',
    question: '¿Qué hace el botón de la varita que aparece junto a los campos?',
    answer: 'Es la captura asistida: un solo agente propone cómo completar ese campo con el contexto del registro y de sus niveles superiores. Propone, nunca escribe: la sugerencia se aplica con un clic tuyo. Si el registro está demasiado vacío para razonar, se niega a inventar en vez de rellenarlo con algo verosímil.',
    where: 'Junto a cada campo de los formularios de iniciativa, proyecto y entregable.',
    keywords: ['varita', 'asistente', 'campo', 'sugerencia', 'completar', 'ayuda', 'formulario', 'captura'],
  }),
  topic({
    id: 'seguimiento',
    question: '¿Cómo sé cómo va un proyecto y qué mueve en su iniciativa?',
    answer: 'En la ficha del proyecto tienes su seguimiento: estado, prioridad, responsable, fechas, avance, hitos y riesgos. Y debajo, los aportes: qué mueve ese proyecto en la iniciativa que lo justifica, contra qué resultado o indicador. La sala de la iniciativa consolida todo eso —avance ponderado, proyectos fuera de rumbo, riesgos heredados y qué resultados no tienen ningún proyecto que los sirva.',
    where: 'Proyecto → Ficha del proyecto. Iniciativa → sección Proyectos.',
    keywords: ['seguimiento', 'avance', 'progreso', 'estado', 'hitos', 'riesgos', 'impacto', 'aporte', 'cumplimiento'],
  }),
  topic({
    id: 'calidad',
    question: '¿Quién revisa lo que se produce?',
    answer: 'Cada artefacto pasa por sus validadores y por las puertas de calidad de la Oficina, y lo revisa un agente distinto del que lo produjo. Cuando la decisión es de gobierno, va al comité de arquitectura, cuyas decisiones quedan registradas y no se pueden reescribir.',
    where: 'Sala del entregable: tareas, puertas y decisiones del comité.',
    keywords: ['calidad', 'revision', 'revisar', 'comite', 'arb', 'gobierno', 'validacion', 'puertas'],
  }),
  topic({
    id: 'publicacion',
    question: '¿Cómo entrego lo que hemos producido?',
    answer: 'Con el centro de publicación del proyecto: reúne los artefactos en un paquete, pasa una comprobación previa —accesibilidad, versiones, aprobaciones— y produce el entregable con su manifiesto y su rastro de auditoría. También puedes exportar un artefacto suelto a Markdown, HTML, PDF, Word, PowerPoint o Excel.',
    where: 'Proyecto → Publicación, o el botón de exportar de cada artefacto.',
    keywords: ['publicar', 'entregar', 'exportar', 'paquete', 'pdf', 'word', 'powerpoint', 'manifiesto'],
  }),
  topic({
    id: 'busqueda',
    question: '¿Cómo encuentro algo rápido?',
    answer: 'Con la búsqueda global, que abre con Cmd+K (o Ctrl+K) y también desde la lupa del raíl: busca en iniciativas, proyectos, entregables y artefactos, y salta directamente. La tecla «?» muestra todos los atajos.',
    where: 'Raíl izquierdo → lupa, o Cmd+K en cualquier pantalla.',
    keywords: ['buscar', 'busqueda', 'encontrar', 'atajo', 'teclado', 'comando', 'paleta'],
  }),
  topic({
    id: 'formacion',
    question: '¿Qué es el Centro de Formación?',
    answer: 'Es el espacio de aprendizaje: cursos, lecciones, laboratorios y notas inteligentes sobre arquitectura y sobre la propia disciplina. Tu progreso se guarda por usuario, y quien tenga el rol de formador puede crear y editar los cursos.',
    where: 'Raíl izquierdo → Formación.',
    keywords: ['formacion', 'curso', 'aprender', 'leccion', 'training', 'lms', 'notas'],
  }),
  topic({
    id: 'roles',
    question: '¿Qué puede hacer cada rol?',
    answer: 'Un lector consulta el portafolio; un arquitecto crea y mantiene iniciativas, proyectos, entregables y artefactos; un revisor además aprueba charters, decide en el comité y publica; un formador es dueño del Centro de Formación; un administrador gestiona usuarios. Las cuentas las crea un administrador: no hay registro por cuenta propia.',
    where: 'Raíl izquierdo → Seguridad (sólo administradores).',
    keywords: ['rol', 'permiso', 'usuario', 'administrador', 'revisor', 'acceso', 'cuenta', 'seguridad'],
  }),
  topic({
    id: 'ajustes',
    question: '¿Dónde configuro el idioma, el tema o el modelo de IA?',
    answer: 'En Configuración: tema claro u oscuro, idioma, el modelo de IA con el que trabaja la plataforma y tus propias claves de proveedor si quieres usarlas. El tema también se cambia desde el propio raíl, sin entrar en Configuración.',
    where: 'Raíl izquierdo → Ajustes.',
    keywords: ['configuracion', 'ajustes', 'tema', 'oscuro', 'idioma', 'modelo', 'clave', 'api'],
  }),
  topic({
    id: 'sin-conexion',
    question: '¿Qué pasa si se cae la conexión o la base de datos?',
    answer: 'La plataforma no pierde tu trabajo: lo guarda en tu propio dispositivo y te avisa con una banda de que lo guardado es local todavía. Nunca te dice que se ha guardado cuando no ha llegado a la base de datos.',
    where: 'La banda de estado aparece arriba, sobre el contenido.',
    keywords: ['conexion', 'offline', 'error', 'guardar', 'perdida', 'local', 'sincronizar'],
  }),
]);
