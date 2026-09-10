import { Template, ArtifactTemplate } from './types';

export const AI_AGENT_DISPLAY_NAME = 'Arquitecto Agente';

export const PROJECT_TEMPLATES: Record<string, Template[]> = {
    "Seguros": [
        { name: "Emisión de Pólizas Grupales", description: "Sistema para la gestión completa de la emisión de pólizas de seguros para grupos y colectivos." },
        { name: "Emisión de Pólizas Individuales de Salud", description: "Plataforma para la cotización y emisión de pólizas de salud para individuos." },
        { name: "Gestión de Endosos y Mantenimiento", description: "Solución para manejar cambios, renovaciones y actualizaciones en pólizas existentes." },
        { name: "Enrolamiento y Mantenimiento de Asegurados", description: "Sistema centralizado para el alta y la gestión de datos de los asegurados." },
        { name: "Gestión de Facturación y Cobros", description: "Automatización de la generación de facturas, gestión de pagos y seguimiento de cartera." },
        { name: "Gestión de Agentes y Comisiones", description: "Plataforma para administrar la red de agentes, sus ventas y el cálculo de comisiones." },
        { name: "Gestión de Red de Proveedores Médicos", description: "Sistema para la administración de la red de hospitales, clínicas y doctores afiliados." },
        { name: "Gestión de Reclamos Médicos", description: "Flujo completo para la recepción, análisis y pago de reclamos de gastos médicos." },
        { name: "Gestión de Reclamos de Vida", description: "Proceso para la gestión de siniestros y pago de pólizas de seguros de vida." },
        { name: "Gestión de Reservas y Reaseguro", description: "Sistema para el cálculo de reservas técnicas y la gestión de contratos de reaseguro." },
        { name: "Suscripción de Riesgos", description: "Herramienta para evaluar y decidir sobre la aceptación de nuevos riesgos de seguros." },
        { name: "Portal de Miembros o Asegurados", description: "Portal de autogestión para que los asegurados consulten sus pólizas, pagos y reclamos." },
        { name: "Portal de Proveedores Médicos", description: "Plataforma para que los proveedores médicos gestionen autorizaciones y pagos." },
        { name: "Portal de Agentes o Brokers", description: "Herramienta para que los agentes coticen, emitan pólizas y sigan sus comisiones." },
        { name: "Portal de Tenedores de Póliza", description: "Portal para empresas que gestionan pólizas grupales para sus empleados." },
        { name: "Gestión del Cuidado y Bienestar", description: "Módulo para que la compañía de seguros administre programas de salud y bienestar en colaboración con proveedores médicos, con el fin de mejorar la salud de los asegurados." }
    ],
    "AWS": [
        { name: "Aplicación Web de 3 Capas", description: "Arquitectura clásica de 3 capas con balanceo de carga, servidores de aplicación y base de datos." },
        { name: "Arquitectura Serverless", description: "Aplicación basada en AWS Lambda, API Gateway y DynamoDB para máxima escalabilidad y bajo costo." },
        { name: "Plataforma de Big Data", description: "Solución para la ingesta, procesamiento y análisis de grandes volúmenes de datos con EMR, S3 y Redshift." },
        { name: "Solución de IoT", description: "Arquitectura para conectar y gestionar dispositivos IoT, recolectando y procesando telemetría." },
        { name: "Microservicios en EKS", description: "Plataforma de microservicios orquestada con Kubernetes (EKS) para despliegues desacoplados y resilientes." },
        { name: "Data Lake en S3", description: "Repositorio centralizado de datos (estructurados y no estructurados) basado en S3 y Glue." },
        { name: "Plataforma de E-commerce Escalable", description: "Arquitectura de comercio electrónico de alta disponibilidad con servicios de AWS." },
        { name: "Aplicación de Medios con Transcoding", description: "Flujo de trabajo para la transcodificación de video y distribución de contenido multimedia a nivel global." },
        { name: "Backend para App Móvil con AppSync", description: "Backend GraphQL gestionado para aplicaciones móviles que simplifica el acceso a datos." },
        { name: "Sistema de Monitoreo y Alertas", description: "Solución centralizada de observabilidad utilizando CloudWatch, X-Ray y OpenSearch." }
    ],
    "Salesforce": [
        { name: "Modelo de Datos Sales Cloud", description: "Diseño del modelo de datos para optimizar el proceso de ventas en Sales Cloud." },
        { name: "Integración de Service Cloud", description: "Arquitectura para la integración de Service Cloud con sistemas de soporte y telefonía." },
        { name: "Portal de Partners (Experience Cloud)", description: "Creación de un portal para que los socios de negocio colaboren y gestionen oportunidades." },
        { name: "Marketing Cloud Journey Automation", description: "Diseño de flujos de automatización de marketing para la captación y nutrición de leads." },
        { name: "Integración con ERP para Vista 360", description: "Sincronización de datos entre Salesforce y un ERP para una visión completa del cliente." },
        { name: "Comunidad de Clientes", description: "Portal de autoservicio para clientes basado en Experience Cloud para soporte y colaboración." },
        { name: "Gestión de Casos con Service Cloud", description: "Optimización del proceso de gestión de casos de soporte al cliente." },
        { name: "Field Service para Técnicos de Campo", description: "Implementación de Field Service Lightning para la gestión de equipos de trabajo en campo." },
        { name: "CPQ para Cotizaciones Complejas", description: "Configuración de Salesforce CPQ para la generación de cotizaciones de productos complejos." },
        { name: "Plataforma de Analytics (Tableau CRM)", description: "Creación de dashboards y análisis predictivo sobre los datos de Salesforce." }
    ],
    "MuleSoft": [
        { name: "API-Led: Clientes 360", description: "Arquitectura API-Led de tres capas (System, Process, Experience) para una vista unificada de clientes." },
        { name: "Orquestación de Pedidos", description: "Flujo de integración para orquestar el procesamiento de pedidos a través de múltiples sistemas." },
        { name: "Integración con Sistema Legacy", description: "Estrategia para exponer y consumir datos de un sistema legacy a través de APIs modernas." },
        { name: "Sincronización de Datos Multi-Nube", description: "Solución para mantener datos consistentes entre diferentes plataformas en la nube (ej. Salesforce y SAP)." },
        { name: "Plataforma de APIs para Partners", description: "Exposición segura de APIs para que los socios de negocio se integren y consuman servicios." },
        { name: "Procesamiento de Pagos en Tiempo Real", description: "Integración con pasarelas de pago y sistemas financieros para procesar transacciones en tiempo real." },
        { name: "Desbloqueo de Datos para IA/ML", description: "Creación de APIs de sistema para que los modelos de IA/ML puedan acceder a datos de sistemas core." },
        { name: "Integración de Sistemas de RRHH", description: "Sincronización de datos de empleados entre sistemas como Workday, SAP SuccessFactors, etc." },
        { name: "API Gateway para Seguridad Centralizada", description: "Implementación de un API Gateway para aplicar políticas de seguridad de forma centralizada." },
        { name: "Modernización de Mainframe", description: "Estrategia para modernizar un mainframe exponiendo su funcionalidad a través de APIs REST." }
    ],
    "Box": [
        { name: "Clasificación Inteligente", description: "Uso de Box Skills para clasificar automáticamente documentos según su contenido." },
        { name: "Extracción de Datos de Contratos", description: "Flujo para extraer metadatos y cláusulas clave de contratos almacenados en Box." },
        { name: "Flujo de Aprobación de Contenido", description: "Automatización del proceso de revisión y aprobación de documentos con Box Relay." },
        { name: "Gestión del Ciclo de Vida de Contratos", description: "Sistema para gestionar contratos desde su creación hasta su archivo o eliminación." },
        { name: "Repositorio Central de Marketing", description: "Estructura de carpetas y metadatos para un repositorio central de activos de marketing." },
        { name: "Colaboración Segura con Externos", description: "Configuración de políticas de seguridad para compartir contenido con colaboradores externos." },
        { name: "Onboarding de Empleados Digital", description: "Proceso automatizado para la recolección y gestión de documentos de nuevos empleados." },
        { name: "Archivo de Documentos Legales", description: "Uso de Box Governance para archivar documentos legales con políticas de retención." },
        { name: "Integración con Firma Electrónica", description: "Integración con servicios como DocuSign para un flujo de firma de documentos sin interrupciones." },
        { name: "Automatización de Facturas de Proveedores", description: "Flujo para capturar, procesar y archivar facturas de proveedores recibidas en Box." }
    ]
};

export const KANBAN_COLUMNS: string[] = [
    "Fase 1: Estratégica y de Visión de Negocio",
    "Fase 2: Diseño Conceptual y Lógico",
    "Fase 3: Diseño Físico y Tecnológico",
    "Fase 4: Implementación y Operaciones",
    "SDD: Especificación",
    "General"
];

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
    // --- Vista de Contexto y Negocio ---
    {
        name: "Mapa de Capacidades de Negocio",
        type: "react-flow-graph",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Visualizar las capacidades clave del negocio para alinear la tecnología con las metas de la empresa.",
        keyConcepts: [
            { term: "Capacidad de Negocio", definition: "Lo que la empresa hace para generar valor (ej. 'Gestionar Inventario')." },
            { term: "Jerarquía", definition: "Cómo se agrupan y descomponen las capacidades." }
        ],
        representation: "diagram"
    },
    {
        name: "Visión de la Arquitectura",
        type: "markdown",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Establecer una visión de alto nivel para la arquitectura, describiendo el estado futuro deseado y los principios guía.",
        keyConcepts: [
            { term: "Estado Futuro (To-Be)", definition: "La arquitectura y capacidades deseadas." },
            { term: "Principios Guía", definition: "Reglas de alto nivel que aseguran la consistencia (ej. 'Cloud-First')." }
        ],
        representation: "document"
    },
     {
        name: "Principios de Arquitectura",
        type: "markdown",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Definir un conjunto de reglas y directrices estratégicas que gobiernan el diseño y la evolución de la arquitectura.",
        keyConcepts: [
            { term: "Principio", definition: "Una declaración de dirección que guía las decisiones (ej. 'Comprar antes que construir')." },
            { term: "Implicación", definition: "Las consecuencias prácticas de seguir el principio." }
        ],
        representation: "document"
    },
    {
        name: "Diagrama de Contexto (C4-N1)",
        type: "mermaid-c4-context",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Mostrar una vista panorámica del sistema, sus usuarios y sus interacciones con otros sistemas externos.",
        keyConcepts: [
            { term: "Sistema", definition: "La aplicación que estás construyendo." },
            { term: "Actor", definition: "Un usuario humano que interactúa con el sistema." },
            { term: "Sistema Externo", definition: "Otro sistema con el que tu sistema se comunica." }
        ],
        representation: "diagram"
    },
    {
        name: "Análisis de Stakeholders",
        type: "markdown",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Identificar a todas las personas y grupos de interés, entender sus necesidades, influencias y expectativas.",
        keyConcepts: [
            { term: "Stakeholder", definition: "Cualquier persona o grupo afectado por el proyecto." },
            { term: "Matriz de Interés/Poder", definition: "Herramienta para clasificar y definir estrategias de comunicación." }
        ],
        representation: "document"
    },
    {
        name: "Mapa de Flujo de Valor",
        type: "hybrid-text-diagram",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Mapear los pasos desde la solicitud de un cliente hasta la entrega de valor para identificar ineficiencias.",
        keyConcepts: [
            { term: "Flujo de Valor", definition: "La secuencia de actividades para entregar un producto o servicio." },
            { term: "Lead Time", definition: "El tiempo total desde el inicio hasta el fin del proceso." }
        ],
        representation: "hybrid"
    },
    {
        name: "Modelo de Proceso de Negocio (BPMN)",
        type: "hybrid-text-diagram",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Modelar visualmente los pasos de un proceso de negocio para entender el 'cómo' y encontrar oportunidades de mejora.",
        keyConcepts: [
            { term: "Evento", definition: "Algo que sucede e inicia, redirige o finaliza un proceso." },
            { term: "Actividad", definition: "Un trabajo que se realiza durante el proceso." },
            { term: "Compuerta (Gateway)", definition: "Un punto de decisión que puede alterar el flujo del proceso." }
        ],
        representation: "hybrid"
    },
    {
        name: "Resumen Ejecutivo",
        type: "presentation-summary",
        phase: "General",
        architecturalView: "Vista de Contexto y Negocio",
        objective: "Generar un briefing deck ejecutivo de alto nivel (5-8 slides) para stakeholders no técnicos y directivos, enfocado en valor de negocio, beneficios, riesgos, decisiones y próximos pasos.",
        keyConcepts: [
            { term: "Problema de Negocio", definition: "El desafío que el proyecto busca resolver." },
            { term: "ROI (Retorno de la Inversión)", definition: "El beneficio financiero esperado del proyecto." }
        ],
        representation: "document",
        artifactKind: "presentation",
        outputFormat: "deck",
        preferredExports: ["pptx", "pdf", "html"]
    },

    // --- Vista Lógica y de Diseño ---
    {
        name: "Diagrama de Contenedores (C4-N2)",
        type: "mermaid-c4-container",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista Lógica y de Diseño",
        objective: "Descomponer el sistema en sus 'contenedores' principales (APIs, bases de datos, aplicaciones web, etc.).",
        keyConcepts: [
            { term: "Contenedor", definition: "Una unidad desplegable (ej. una API, una base de datos)." },
            { term: "Límite del Sistema", definition: "La frontera que separa tu sistema de los externos." }
        ],
        representation: "diagram"
    },
    {
        name: "Diagrama de Componentes (C4-N3)",
        type: "mermaid-c4-component",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista Lógica y de Diseño",
        objective: "Descomponer un contenedor en sus componentes internos (ej. controladores, servicios, repositorios).",
        keyConcepts: [
            { term: "Componente", definition: "Una unidad de código con una responsabilidad clara dentro de un contenedor." },
            { term: "Interfaz", definition: "El punto de entrada o contrato de un componente." }
        ],
        representation: "diagram"
    },
    {
        name: "Diagrama de Integración",
        type: "mermaid-graph",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista Lógica y de Diseño",
        objective: "Visualizar cómo se conectan e interactúan los diferentes sistemas, APIs y componentes.",
        keyConcepts: [
            { term: "Punto de Integración", definition: "El lugar donde dos sistemas se conectan (ej. un endpoint de API)." },
            { term: "Patrón de Integración", definition: "Una forma estandarizada de integración (ej. 'Publicador/Suscriptor')." }
        ],
        representation: "diagram"
    },
    {
        name: "Contrato de API (OpenAPI)",
        type: "yaml",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista Lógica y de Diseño",
        objective: "Definir formalmente la especificación de una API RESTful usando el estándar OpenAPI.",
        keyConcepts: [
            { term: "Endpoint", definition: "La URL específica para una operación de la API." },
            { term: "Esquema", definition: "La estructura de los datos de solicitud y respuesta." }
        ],
        representation: "document"
    },
    {
        name: "Catálogo de Patrones de Diseño",
        type: "hybrid-text-diagram",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista Lógica y de Diseño",
        objective: "Documentar los patrones de diseño de software (ej. 'Singleton', 'Factory') que se utilizarán en el proyecto.",
        keyConcepts: [
            { term: "Patrón de Diseño", definition: "Una solución reutilizable a un problema de diseño de software." },
            { term: "Contexto del Problema", definition: "La situación en la que el patrón es aplicable." }
        ],
        representation: "hybrid"
    },
    {
        name: "Resumen de Arquitectura",
        type: "presentation-overview",
        phase: "General",
        architecturalView: "Vista Lógica y de Diseño",
        objective: "Generar un deck sintético de arquitectura (6-10 slides) para una audiencia técnica y semi-ejecutiva, con visión general, capacidades, componentes, integraciones, decisiones, riesgos y próximos pasos.",
        keyConcepts: [
            { term: "Vista Lógica", definition: "Cómo se organiza el sistema en componentes de software." },
            { term: "Vista Física", definition: "Cómo se despliega el software en la infraestructura." }
        ],
        representation: "document",
        artifactKind: "presentation",
        outputFormat: "deck",
        preferredExports: ["pptx", "pdf", "html"]
    },

    // --- Vista de Datos ---
    {
        name: "Modelo de Dominio (ERD)",
        type: "react-flow-graph",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Datos",
        objective: "Representar las entidades de negocio clave, sus atributos y las relaciones que existen entre ellas.",
        keyConcepts: [
            { term: "Entidad", definition: "Un objeto o concepto del que se almacena información (ej. 'Cliente')." },
            { term: "Atributo", definition: "Una propiedad de una entidad (ej. 'Nombre' del Cliente)." },
            { term: "Relación", definition: "Cómo se asocian las entidades entre sí." }
        ],
        representation: "diagram"
    },
    {
        name: "Diagrama de Flujo de Datos Lógico",
        type: "mermaid-graph",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Datos",
        objective: "Mostrar cómo fluyen los datos a través del sistema, identificando procesos y almacenes de datos.",
        keyConcepts: [
            { term: "Proceso", definition: "Una actividad que transforma datos." },
            { term: "Almacén de Datos", definition: "Un lugar donde se guardan los datos." },
            { term: "Flujo de Datos", definition: "El movimiento de datos entre procesos, almacenes y entidades." }
        ],
        representation: "diagram"
    },
    {
        name: "Modelo Físico de Datos",
        type: "react-flow-graph",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Datos",
        objective: "Traducir el modelo lógico a un diseño específico para una base de datos (tablas, columnas, índices).",
        keyConcepts: [
            { term: "Tabla", definition: "La implementación de una entidad en la base de datos." },
            { term: "Índice", definition: "Una estructura que mejora la velocidad de recuperación de datos." }
        ],
        representation: "diagram"
    },
    {
        name: "Diccionario de Datos",
        type: "markdown",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Datos",
        objective: "Crear un catálogo centralizado de definiciones para todos los elementos de datos del sistema.",
        keyConcepts: [
            { term: "Elemento de Dato", definition: "Un campo individual (ej. 'CustomerID')." },
            { term: "Tipo de Dato", definition: "El formato del dato (ej. 'Entero', 'Cadena')." },
            { term: "Regla de Validación", definition: "Criterios que el dato debe cumplir (ej. 'No puede ser nulo')." }
        ],
        representation: "document"
    },
     {
        name: "Estrategia de Migración de Datos",
        type: "markdown",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Datos",
        objective: "Planificar el proceso de mover datos desde un sistema de origen a un sistema de destino.",
        keyConcepts: [
            { term: "ETL (Extract, Transform, Load)", definition: "El proceso de extraer, transformar y cargar datos." },
            { term: "Mapeo de Datos", definition: "Cómo se corresponden los campos del sistema antiguo con los del nuevo." },
            { term: "Plan de Cutover", definition: "La estrategia para realizar la transición final al nuevo sistema." }
        ],
        representation: "document"
    },

    // --- Vista de Proceso e Interacción ---
    {
        name: "Diagrama de Secuencia",
        type: "mermaid-sequence",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Proceso e Interacción",
        objective: "Ilustrar las interacciones entre componentes a lo largo del tiempo para un escenario específico (ej. 'Procesar pago').",
        keyConcepts: [
            { term: "Línea de Vida", definition: "Representa un participante en la interacción." },
            { term: "Mensaje", definition: "La comunicación entre dos líneas de vida." }
        ],
        representation: "diagram"
    },
    {
        name: "Diagrama de Máquina de Estados",
        type: "mermaid-state",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Proceso e Interacción",
        objective: "Modelar el comportamiento de un objeto, describiendo sus estados y las transiciones entre ellos.",
        keyConcepts: [
            { term: "Estado", definition: "Una condición en la vida de un objeto." },
            { term: "Transición", definition: "Un cambio de un estado a otro, usualmente causado por un evento." }
        ],
        representation: "diagram"
    },
    {
        name: "Diagrama de Casos de Uso",
        type: "hybrid-text-diagram",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Proceso e Interacción",
        objective: "Representar las interacciones entre los actores (usuarios) y el sistema.",
        keyConcepts: [
            { term: "Actor", definition: "Alguien o algo que interactúa con el sistema." },
            { term: "Caso de Uso", definition: "Una secuencia de acciones que el sistema realiza para un actor." }
        ],
        representation: "hybrid"
    },

    // --- Vista Física y de Despliegue ---
    {
        name: "Diagrama de Despliegue (C4-N4)",
        type: "mermaid-c4-deployment",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista Física y de Despliegue",
        objective: "Mostrar cómo se despliegan los contenedores del software en la infraestructura (servidores, redes, etc.).",
        keyConcepts: [
            { term: "Nodo de Despliegue", definition: "Un entorno de ejecución (ej. un servidor, un contenedor Docker)." },
            { term: "Entorno", definition: "Un contexto de despliegue ('Desarrollo', 'Producción')." }
        ],
        representation: "diagram"
    },
    {
        name: "Diagrama de Arquitectura de Red",
        type: "mermaid-graph",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista Física y de Despliegue",
        objective: "Visualizar la topología de la red, incluyendo subredes, firewalls y balanceadores de carga.",
        keyConcepts: [
            { term: "Subred", definition: "Una subdivisión de una red IP." },
            { term: "Firewall", definition: "Un dispositivo de seguridad que controla el tráfico de red." }
        ],
        representation: "diagram"
    },
    {
        name: "Modelo de Costos de Infraestructura",
        type: "markdown",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista Física y de Despliegue",
        objective: "Estimar los costos de la infraestructura necesaria para ejecutar la solución.",
        keyConcepts: [
            { term: "TCO", definition: "Costo Total de Propiedad (Total Cost of Ownership)." },
            { term: "Optimización de Costos", definition: "Estrategias para reducir los gastos de infraestructura." }
        ],
        representation: "document"
    },
    {
        name: "Diagrama del Pipeline CI/CD",
        type: "mermaid-graph",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista Física y de Despliegue",
        objective: "Visualizar las etapas del pipeline de Integración y Despliegue Continuo (CI/CD).",
        keyConcepts: [
            { term: "CI (Integración Continua)", definition: "El proceso de fusionar y probar automáticamente los cambios." },
            { term: "CD (Despliegue Continuo)", definition: "El proceso de liberar automáticamente el software." }
        ],
        representation: "diagram"
    },
    {
        name: "Plan de Recuperación ante Desastres (DRP)",
        type: "markdown",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista Física y de Despliegue",
        objective: "Definir la estrategia y los procedimientos para restaurar el servicio después de una interrupción mayor.",
        keyConcepts: [
            { term: "RTO (Recovery Time Objective)", definition: "El tiempo máximo aceptable para que el sistema esté inactivo." },
            { term: "RPO (Recovery Point Objective)", definition: "La cantidad máxima aceptable de pérdida de datos." }
        ],
        representation: "document"
    },

    // --- Vista de Gestión y Soporte ---
    {
        name: "Especificación de Requerimientos (SRS)",
        type: "markdown",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Documentar de forma completa los requerimientos funcionales y no funcionales.",
        keyConcepts: [
            { term: "Requerimiento Funcional", definition: "Describe una función que el sistema debe realizar." },
            { term: "Requerimiento No Funcional", definition: "Describe una cualidad del sistema (ej. rendimiento)." }
        ],
        representation: "document"
    },
    {
        name: "Catálogo de Decisiones (ADR)",
        type: "markdown",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Registrar las decisiones arquitectónicas importantes (Architecture Decision Records).",
        keyConcepts: [
            { term: "Decisión", definition: "La elección tomada (ej. 'Usar base de datos PostgreSQL')." },
            { term: "Contexto", definition: "Las fuerzas y requerimientos que influyeron en la decisión." }
        ],
        representation: "document"
    },
    {
        name: "Registro de Decisiones Arquitectónicas (ADR)",
        type: "markdown",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Documentar decisiones clave de arquitectura y sus justificaciones.",
        keyConcepts: [
            { term: "Decisión", definition: "La elección técnica o arquitectónica tomada." },
            { term: "Contexto", definition: "El problema, alternativas consideradas y factores que influyeron en la decisión." }
        ],
        representation: "document"
    },
    {
        name: "Plan de Proyecto (Gantt)",
        type: "mermaid-gantt",
        phase: "Fase 1: Estratégica y de Visión de Negocio",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Crear un cronograma visual del proyecto, mostrando fases, tareas y dependencias.",
        keyConcepts: [
            { term: "Tarea", definition: "Una actividad específica con un inicio y un fin." },
            { term: "Hito (Milestone)", definition: "Un punto de control importante en el cronograma." }
        ],
        representation: "diagram"
    },
    {
        name: "Casos de Prueba",
        type: "markdown",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Definir los escenarios y pasos de prueba para verificar que el sistema funciona como se espera.",
        keyConcepts: [
            { term: "Prueba Unitaria", definition: "Prueba de un componente individual del software." },
            { term: "Prueba de Integración", definition: "Prueba de cómo múltiples componentes funcionan juntos." }
        ],
        representation: "document"
    },
    {
        name: "Manual de Operaciones / Runbook",
        type: "markdown",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Crear una guía detallada para el equipo de operaciones con procedimientos para tareas comunes y resolución de incidentes.",
        keyConcepts: [
            { term: "Procedimiento", definition: "Una serie de pasos para realizar una tarea específica." },
            { term: "Troubleshooting", definition: "El proceso de diagnosticar y resolver problemas." }
        ],
        representation: "document"
    },
    {
        name: "Plan de Monitorización",
        type: "hybrid-text-diagram",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Definir qué métricas clave se monitorizarán, qué herramientas se usarán y cómo se configurarán las alertas.",
        keyConcepts: [
            { term: "Métrica", definition: "Un dato medible sobre el rendimiento o la salud del sistema." },
            { term: "Alerta", definition: "Una notificación que se dispara cuando una métrica cruza un umbral." }
        ],
        representation: "hybrid"
    },
    {
        name: "Modelo de Amenazas",
        type: "hybrid-text-diagram",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Identificar y evaluar posibles amenazas de seguridad y vulnerabilidades en la arquitectura.",
        keyConcepts: [
            { term: "Amenaza", definition: "Un evento potencial que podría dañar el sistema." },
            { term: "Contramedida", definition: "Una acción para reducir el riesgo de una amenaza." }
        ],
        representation: "hybrid"
    },
    {
        name: "Matriz de Controles de Seguridad",
        type: "markdown",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Mapear requerimientos de seguridad a los componentes de la arquitectura que los implementan para garantizar la cobertura.",
        keyConcepts: [
            { term: "Control de Seguridad", definition: "Una medida para proteger la confidencialidad, integridad y disponibilidad (ej. 'Cifrado en reposo')." },
            { term: "Marco de Cumplimiento", definition: "Un estándar al que se debe adherir (ej. 'PCI-DSS', 'HIPAA')." }
        ],
        representation: "document"
    },
     {
        name: "README del Proyecto",
        type: "markdown",
        phase: "General",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Servir como la página de inicio del repositorio, explicando qué es el proyecto y cómo empezar a trabajar con él.",
        keyConcepts: [
            { term: "Instalación", definition: "Instrucciones para configurar el entorno de desarrollo." },
            { term: "Uso", definition: "Ejemplos de cómo ejecutar y utilizar el software." }
        ],
        representation: "document"
    },
    {
        name: "Informe de Revisión de Arquitectura",
        type: "markdown",
        phase: "General",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Generar un análisis completo de la arquitectura actual del proyecto, identificando fortalezas, riesgos y recomendaciones.",
        keyConcepts: [
            { term: "Fortalezas", definition: "Aspectos positivos del diseño." },
            { term: "Riesgos", definition: "Debilidades potenciales en áreas como rendimiento, seguridad, costos." },
            { term: "Recomendaciones", definition: "Sugerencias accionables para mejorar la arquitectura." }
        ],
        representation: "document"
    },
    {
        name: "Presentación Ejecutiva",
        type: "presentation-executive",
        phase: "General",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Generar un deck ejecutivo (8-12 slides) para directivos, sponsors y stakeholders no técnicos. Debe cubrir: portada, contexto, problema, objetivos, valor de negocio, arquitectura objetivo/visión, roadmap, riesgos, decisiones requeridas y cierre.",
        keyConcepts: [],
        representation: "document",
        artifactKind: "presentation",
        outputFormat: "deck",
        preferredExports: ["pptx", "pdf", "html"]
    },
    {
        name: "Presentación Técnica",
        type: "presentation-technical",
        phase: "General",
        architecturalView: "Vista de Gestión y Soporte",
        objective: "Generar un deck técnico detallado (10-15 slides) para equipos de arquitectura, desarrollo, seguridad e integración. Debe cubrir: portada, contexto técnico, arquitectura actual, arquitectura objetivo, componentes, integraciones, seguridad, datos, despliegue, observabilidad, riesgos técnicos, ADRs y próximos pasos.",
        keyConcepts: [],
        representation: "document",
        artifactKind: "presentation",
        outputFormat: "deck",
        preferredExports: ["pptx", "pdf", "html"]
    },

    // --- Vista de Calidad y Validación ---
    {
        name: "Escenarios de Atributos de Calidad",
        type: "hybrid-text-diagram",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Calidad y Validación",
        objective: "Especificar requerimientos no funcionales de manera medible y comprobable (Fuente, Estímulo, Respuesta).",
        keyConcepts: [
            { term: "Escenario", definition: "Historia corta que describe una interacción de calidad." },
            { term: "Medida de Respuesta", definition: "Métrica cuantitativa para validar el escenario." }
        ],
        representation: "hybrid"
    },
    {
        name: "Árbol de Utilidad",
        type: "mermaid-graph",
        phase: "Fase 2: Diseño Conceptual y Lógico",
        architecturalView: "Vista de Calidad y Validación",
        objective: "Priorizar los atributos de calidad (ASRs) basándose en el valor para el negocio y el riesgo arquitectónico.",
        keyConcepts: [
            { term: "ASR", definition: "Requerimiento Arquitectónicamente Significativo." },
            { term: "Priorización (H/M/L)", definition: "Clasificación por Impacto de Negocio y Riesgo Técnico." }
        ],
        representation: "diagram"
    },
    {
        name: "Matriz de Tácticas de Arquitectura",
        type: "markdown",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Calidad y Validación",
        objective: "Mapear los atributos de calidad deseados con las decisiones de diseño y patrones técnicos implementados.",
        keyConcepts: [
            { term: "Táctica", definition: "Decisión de diseño que influye en el control de una respuesta de calidad." },
            { term: "Patrón", definition: "Solución general reutilizable a un problema común." }
        ],
        representation: "document"
    },
    {
        name: "Análisis de Compromisos (Trade-offs)",
        type: "markdown",
        phase: "Fase 3: Diseño Físico y Tecnológico",
        architecturalView: "Vista de Calidad y Validación",
        objective: "Documentar y justificar los conflictos entre atributos de calidad (ej. Seguridad vs Rendimiento).",
        keyConcepts: [
            { term: "Trade-off", definition: "Situación donde mejorar una cualidad afecta negativamente a otra." },
            { term: "Justificación", definition: "Razón de negocio para priorizar un atributo sobre otro." }
        ],
        representation: "document"
    },
    {
        name: "Definición de Fitness Functions",
        type: "markdown",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Calidad y Validación",
        objective: "Diseñar pruebas automatizadas que validen continuamente la integridad de la arquitectura.",
        keyConcepts: [
            { term: "Fitness Function", definition: "Función objetivo utilizada para evaluar qué tan cerca está una solución de la meta." },
            { term: "Prueba de Arquitectura", definition: "Test que falla si se viola una regla arquitectónica (ej. dependencias cíclicas)." }
        ],
        representation: "document"
    },
    {
        name: "Estrategia de Observabilidad",
        type: "hybrid-text-diagram",
        phase: "Fase 4: Implementación y Operaciones",
        architecturalView: "Vista de Calidad y Validación",
        objective: "Definir el modelo de telemetría para monitorear la salud y el comportamiento del sistema en producción.",
        keyConcepts: [
            { term: "MELT", definition: "Métricas, Eventos, Logs y Trazas." },
            { term: "Correlación", definition: "Capacidad de vincular logs, métricas y trazas para un contexto completo." }
        ],
        representation: "hybrid"
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Vista SDD — Specification-Driven Development
    // ─────────────────────────────────────────────────────────────────────────

    // FASE 1 SDD: Especificación de Requisitos
    {
        name: "BRD — Documento de Requisitos de Negocio",
        type: "sdd-brd",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Capturar los requisitos de negocio de alto nivel, el problema que se resuelve, los objetivos del proyecto, los stakeholders clave y los criterios de éxito, siguiendo el estándar IEEE 830.",
        keyConcepts: [
            { term: "Requisito de Negocio", definition: "Necesidad de alto nivel que el sistema debe satisfacer para generar valor al negocio." },
            { term: "Criterio de Éxito", definition: "Condición medible que indica si el proyecto ha cumplido su objetivo." },
            { term: "Stakeholder", definition: "Persona o grupo con interés legítimo en el sistema o sus resultados." },
            { term: "Alcance", definition: "Límites explícitos de lo que el sistema hará y no hará." }
        ],
        representation: "document"
    },
    {
        name: "Especificación de Casos de Uso",
        type: "sdd-use-case",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Describir en detalle las interacciones entre los actores del sistema y el sistema mismo, incluyendo flujos principal, alternativo y de excepción, siguiendo UML 2.5.",
        keyConcepts: [
            { term: "Actor", definition: "Entidad externa (usuario, sistema) que interactúa con el sistema." },
            { term: "Flujo Principal", definition: "La secuencia de pasos del escenario exitoso (happy path)." },
            { term: "Flujo Alternativo", definition: "Variaciones válidas del flujo principal." },
            { term: "Precondición", definition: "Estado requerido del sistema antes de que el caso de uso pueda ejecutarse." },
            { term: "Postcondición", definition: "Estado garantizado del sistema tras la ejecución exitosa." }
        ],
        representation: "document"
    },
    {
        name: "User Story Map — Mapa de Historias de Usuario",
        type: "sdd-user-story",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Organizar las historias de usuario en un mapa visual que refleja el recorrido del usuario, agrupadas por épicas y ordenadas por prioridad para definir el backlog y el MVP.",
        keyConcepts: [
            { term: "Épica", definition: "Unidad grande de trabajo que se descompone en historias de usuario." },
            { term: "Historia de Usuario", definition: "Descripción corta de una funcionalidad desde la perspectiva del usuario: 'Como [rol] quiero [acción] para [beneficio]'." },
            { term: "Criterio de Aceptación", definition: "Condiciones que deben cumplirse para que la historia se considere completa." },
            { term: "MVP", definition: "Producto Mínimo Viable: el conjunto mínimo de funcionalidades que aporta valor al usuario." }
        ],
        representation: "document"
    },

    // FASE 2 SDD: Especificación de Arquitectura
    {
        name: "Modelo de Dominio DDD",
        type: "sdd-domain-model",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Modelar el dominio del negocio utilizando Domain-Driven Design: identificar Bounded Contexts, Aggregates, Entities, Value Objects, Domain Events y los mapas de contexto entre subdominios.",
        keyConcepts: [
            { term: "Bounded Context", definition: "Límite explícito dentro del cual un modelo de dominio es consistente y coherente." },
            { term: "Aggregate", definition: "Grupo de objetos de dominio tratados como una unidad para cambios de datos." },
            { term: "Entity", definition: "Objeto con identidad única que persiste a través del tiempo." },
            { term: "Value Object", definition: "Objeto sin identidad propia, definido por sus atributos (ej: Dinero, Dirección)." },
            { term: "Domain Event", definition: "Algo significativo que ocurrió en el dominio (ej: 'PólizaEmitida')." }
        ],
        representation: "hybrid"
    },
    {
        name: "Event Storming — Mapa de Eventos de Dominio",
        type: "sdd-event-storming",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Descubrir y modelar los eventos de dominio, comandos, actores, políticas y sistemas externos que componen el flujo de negocio, utilizando la técnica de Event Storming de Alberto Brandolini.",
        keyConcepts: [
            { term: "Domain Event (naranja)", definition: "Algo que ocurrió en el pasado y es relevante para el negocio (ej: 'ReclaimAprobado')." },
            { term: "Command (azul)", definition: "Intención de un actor de cambiar el estado del sistema (ej: 'AprobarReclamo')." },
            { term: "Policy (lila)", definition: "Regla de negocio que reacciona a un evento y dispara un comando." },
            { term: "Read Model (verde)", definition: "Vista de datos que el actor consulta para tomar una decisión." },
            { term: "Hot Spot (rojo)", definition: "Área de incertidumbre, conflicto o complejidad que requiere atención." }
        ],
        representation: "hybrid"
    },
    {
        name: "Glosario — Lenguaje Ubicuo (Ubiquitous Language)",
        type: "sdd-glossary",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Definir el vocabulario compartido entre desarrolladores y expertos del negocio para eliminar ambigüedades en las especificaciones y el código.",
        keyConcepts: [
            { term: "Ubiquitous Language", definition: "Lenguaje común utilizado por todos los miembros del equipo en conversaciones, documentos y código." },
            { term: "Término de Dominio", definition: "Palabra o frase con significado preciso dentro del contexto del negocio." },
            { term: "Alias / Sinónimo", definition: "Palabras alternativas que se deben evitar para mantener consistencia." }
        ],
        representation: "document"
    },

    // FASE 4 SDD: Especificación de Calidad
    {
        name: "NFR — Requisitos No Funcionales (ISO 25010)",
        type: "sdd-nfr",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Especificar los requisitos de calidad del sistema de forma medible y verificable, cubriendo las características de ISO 25010: rendimiento, seguridad, usabilidad, fiabilidad, mantenibilidad y portabilidad.",
        keyConcepts: [
            { term: "ISO 25010", definition: "Estándar internacional que define las características de calidad del software." },
            { term: "Requisito No Funcional", definition: "Restricción sobre cómo el sistema realiza su función (ej: 'El sistema debe responder en < 200ms')." },
            { term: "Métrica de Calidad", definition: "Medida cuantitativa que permite verificar si se cumple el NFR." },
            { term: "SLO (Service Level Objective)", definition: "Objetivo de nivel de servicio acordado con el negocio." }
        ],
        representation: "document"
    },
    {
        name: "Escenarios BDD — Gherkin (Given/When/Then)",
        type: "sdd-bdd",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Expresar los criterios de aceptación como escenarios ejecutables en lenguaje Gherkin (Given/When/Then), conectando las historias de usuario con pruebas automatizables y comprensibles para el negocio.",
        keyConcepts: [
            { term: "Feature", definition: "Funcionalidad del sistema descrita en lenguaje natural." },
            { term: "Scenario", definition: "Ejemplo concreto del comportamiento del sistema en una situación específica." },
            { term: "Given", definition: "Contexto inicial del escenario (estado previo)." },
            { term: "When", definition: "Acción que el actor realiza." },
            { term: "Then", definition: "Resultado esperado verificable del sistema." }
        ],
        representation: "document"
    },

    // TRANSVERSAL SDD: Trazabilidad
    {
        name: "Matriz de Trazabilidad de Requisitos",
        type: "sdd-traceability",
        phase: "SDD: Especificación",
        architecturalView: "Vista SDD",
        objective: "Establecer y mantener la trazabilidad bidireccional entre requisitos de negocio, casos de uso, historias de usuario, componentes de arquitectura y casos de prueba, siguiendo IEEE 29148.",
        keyConcepts: [
            { term: "Trazabilidad", definition: "Capacidad de rastrear un requisito desde su origen hasta su implementación y prueba." },
            { term: "Trazabilidad hacia adelante", definition: "Conexión de requisito → diseño → código → prueba." },
            { term: "Trazabilidad hacia atrás", definition: "Desde la prueba → código → diseño → requisito de negocio." },
            { term: "Cobertura de Requisitos", definition: "Porcentaje de requisitos cubiertos por al menos un caso de prueba." }
        ],
        representation: "document"
    }
];