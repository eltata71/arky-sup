import type { Artifact, ArtifactType } from '../../types';
import type { DiagramIR } from '../../lib/diagram';

export const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'art-compiler-1',
  versionGroupId: 'vg-compiler-1',
  version: 1,
  createdAt: '2026-05-17T00:00:00.000Z',
  name: 'Artefacto de prueba',
  type: 'markdown' as ArtifactType,
  phase: 'Lógica',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '',
  objective: 'Objetivo del artefacto',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

export const validDiagramIR = (): DiagramIR => ({
  nodes: [
    { id: 'gateway', label: 'API Gateway', kind: 'Container', description: 'Recibe tráfico externo' },
    { id: 'svc', label: 'Order Service', kind: 'Container', description: 'Procesa órdenes' },
    { id: 'db', label: 'Order DB', kind: 'Database', description: 'PostgreSQL 15', technology: 'PostgreSQL 15' },
  ],
  edges: [
    { id: 'e1', source: 'gateway', target: 'svc', label: 'REST / HTTPS' },
    { id: 'e2', source: 'svc', target: 'db', label: 'JDBC' },
  ],
  groups: [],
  metadata: { sourceFormat: 'mermaid', title: 'Order System' },
});

// ── Document content samples ────────────────────────────────────────────────

export const richMarkdown = `# Documento de Diseño

## Objetivo
Definir la arquitectura del módulo de órdenes para sostener diez veces el
tráfico actual sin degradar la latencia percibida por los clientes finales.

## Contexto
El sistema monolítico actual no escala y concentra el riesgo operativo en una
única base de datos compartida por todos los dominios de negocio.

## Alcance
- **Incluye:** módulo de órdenes y pagos.
- **Excluye:** integraciones legadas pendientes de retiro.

## Riesgos
| Riesgo | Severidad | Mitigación |
|---|---|---|
| Migración de datos | Alta | Backfill incremental verificado |
`;

export const brdComplete = `# BRD — Plataforma de Órdenes

## Objetivo de negocio
Incrementar la conversión de checkout en un quince por ciento durante el
próximo año fiscal habilitando una plataforma de órdenes moderna y resiliente.

## Alcance
- **Incluye:** captura, validación y seguimiento de órdenes.
- **Excluye:** la facturación electrónica, gestionada por otro programa.

## Stakeholders
| Stakeholder | Rol | Interés |
|---|---|---|
| Dirección Comercial | Patrocinador | Crecimiento de ingresos |
| Operaciones | Usuario | Eficiencia del proceso |

## Requerimientos funcionales
- **RF-01** El sistema debe permitir crear, editar y cancelar órdenes.
- **RF-02** El sistema debe notificar cambios de estado al cliente.

## Requerimientos no funcionales
- **RNF-01** La latencia p99 debe mantenerse por debajo de 250 milisegundos.
- **RNF-02** La disponibilidad mensual debe ser del 99.9 por ciento.

## Reglas de negocio
- Una orden sólo puede cancelarse antes de su despacho.

## Supuestos
- El equipo de operaciones dedicará dos ingenieros al programa.

## Riesgos
| Riesgo | Severidad | Mitigación |
|---|---|---|
| Adopción lenta | Media | Plan de gestión del cambio |

## Criterios de aceptación
- [ ] La conversión de checkout mejora de forma medible.
- [ ] Todos los requerimientos funcionales tienen pruebas asociadas.
`;

export const useCaseComplete = `# Caso de Uso — Registrar Orden

## Actor principal
El cliente registrado que interactúa con la tienda en línea para comprar.

## Precondiciones
- El cliente ha iniciado sesión correctamente.
- Existe al menos un producto disponible en el catálogo activo.

## Flujo principal
1. El cliente selecciona productos y abre el carrito de compra.
2. El cliente confirma la dirección de envío y el método de pago.
3. El sistema valida el inventario y registra la orden.

## Flujos alternos
- Si el cliente aplica un cupón, el sistema recalcula el total.

## Excepciones
- Si el inventario es insuficiente, el sistema informa y sugiere alternativas.

## Postcondiciones
- La orden queda registrada con estado "pendiente de pago".

## Reglas de negocio
- El total nunca puede ser negativo tras aplicar descuentos.

## Criterios de aceptación
- [ ] La orden se persiste con un identificador único y trazable.
`;

export const userStoryComplete = `# Mapa de Historias — Checkout

## Épicas
- Épica: experiencia de checkout simplificada.

## Historias de usuario
- **Como** cliente, **quiero** pagar en un solo paso, **para** comprar rápido.
- **Como** cliente, **quiero** guardar mi tarjeta, **para** evitar reescribirla.

## Criterios de aceptación
- [ ] El pago de un solo paso se completa en menos de tres interacciones.

## Prioridad
- La historia de pago de un paso tiene prioridad alta (MoSCoW: Must).

## Dependencias
- Depende del servicio de tokenización de tarjetas.

## Riesgos
- Riesgo de cumplimiento PCI si la tokenización se retrasa.

## Definición de terminado
- La funcionalidad tiene pruebas automatizadas y documentación actualizada.
`;

export const nfrComplete = `# Requisitos No Funcionales

## Atributos de calidad
| Atributo | Métrica | Umbral | Escenario | Medición | Riesgo |
|---|---|---|---|---|---|
| Rendimiento | Latencia p99 | < 250 ms | Pico de tráfico | APM | Pérdida de ventas |
| Disponibilidad | Uptime | 99.9% | Mes calendario | Monitoreo sintético | Multas SLA |

## Métricas y umbrales
Cada atributo de calidad define una métrica objetiva y un umbral verificable.

## Escenarios de calidad
- Ante un pico de tráfico del triple, la latencia se mantiene bajo el umbral.

## Método de medición
La medición se realiza con observabilidad continua y pruebas de carga.

## Riesgos
- Una degradación de latencia impacta directamente la conversión.

## Evidencia / trazabilidad
- Cada NFR se enlaza con su requisito de negocio de origen.
`;

export const bddComplete = `# Escenarios BDD — Checkout

## Escenarios

\`\`\`gherkin
Feature: Checkout de un solo paso

  Scenario: Pago exitoso con tarjeta válida
    Given un cliente con una tarjeta válida tokenizada
    When confirma el pago de su orden
    Then la orden cambia a estado pagado

  Scenario: Pago rechazado con fondos insuficientes
    Given un cliente con una tarjeta sin fondos
    When confirma el pago de su orden
    Then el sistema muestra un mensaje de error claro
\`\`\`

## Reglas de negocio
- Una orden pagada no puede volver al estado pendiente.
`;

export const traceabilityComplete = `# Matriz de Trazabilidad

## Matriz de trazabilidad
| Requisito | Fuente | Artefacto | Caso de prueba | Estado | Riesgo | Cobertura |
|---|---|---|---|---|---|---|
| RF-01 | BRD | API de Órdenes | TC-01 | Aprobado | Bajo | Completa |
| RF-02 | BRD | Servicio de Notificaciones | TC-02 | En curso | Medio | Parcial |

## Cobertura
La cobertura global de requisitos verificados alcanza el ochenta por ciento.
`;

export const glossaryComplete = `# Glosario de Lenguaje Ubicuo

## Términos
| Término | Definición | Dominio |
|---|---|---|
| Orden | Solicitud de compra confirmada por un cliente | Ventas |
| Despacho | Proceso de preparación y envío de una orden | Logística |

## Definiciones
Cada término tiene una definición recomendada y sin ambigüedad.

## Dominio
Los términos se agrupan por dominio de negocio.

## Sinónimos
- "Pedido" es sinónimo aceptado de "Orden".
`;

export const domainModelComplete = `# Modelo de Dominio — Ventas

## Entidades
- Orden, Cliente, Producto y Pago son las entidades centrales del dominio.

## Atributos principales
- La Orden tiene identificador, fecha, estado y total.

## Relaciones
- Un Cliente realiza muchas Órdenes; una Orden contiene muchas líneas.

## Bounded contexts
- El contexto de Ventas se separa del contexto de Logística.

## Agregados
- La Orden es la raíz de agregado de sus líneas de detalle.

## Reglas de dominio
- El total de la orden siempre es la suma de sus líneas.
`;

export const eventStormingComplete = `# Event Storming — Ventas

## Eventos de dominio
- Orden Creada, Pago Confirmado y Orden Despachada.

## Comandos
- Crear Orden, Confirmar Pago y Despachar Orden.

## Agregados
- El agregado Orden coordina la consistencia del proceso.

## Actores
- Cliente y Operador de Logística.

## Sistemas externos
- Pasarela de Pagos y Servicio de Mensajería.

## Políticas
- Cuando se confirma el pago, se programa el despacho.

## Read models
- Tablero de órdenes pendientes para operaciones.
`;

export const placeholderDocument = `# Documento con Pendientes

## Objetivo
El objetivo de este documento es describir la modernización del módulo de
órdenes. TODO: cuantificar las metas de negocio con cifras concretas.

## Contexto
El sistema actual concentra el riesgo operativo en una base monolítica que ya
no escala. El contexto detallado está PENDIENTE de revisión por arquitectura.

## Alcance
- **Incluye:** la migración del módulo de órdenes a un servicio dedicado.
- **Excluye:** la facturación electrónica y los reportes regulatorios.

## Riesgos
La migración de datos es el riesgo principal del programa y exige un plan de
backfill incremental verificado. FIXME completar el análisis de riesgos antes
de la revisión final con el comité de arquitectura empresarial.
`;

export const incompleteTableDocument = `# Reporte con Tabla

## Objetivo
Mostrar el avance del programa de modernización para el comité directivo.

## Estado
| Iniciativa | Responsable | Estado |
|---|---|---|
| Migración |  |  |
|  |  |  |
`;
