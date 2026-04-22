// seed.js - preloads a default hackathon with the Ciberdemocracia rubric + phases on first run
import {
  listHackathons, createHackathon,
  listTemplates, createTemplate,
  listPhases, createPhase,
} from './db.js';

const CIBERDEMOCRACIA_RUBRIC = {
  name: 'Rúbrica Selección Ciberdemocracia',
  kind: 'rubric',
  sections: [
    {
      name: 'EVALUACIÓN',
      criteria: [
        {
          label: '1. Claridad del problema democrático (0–25 puntos) La capacidad del equipo para definir un problema específico del sistema democrático, contextualizarlo adecuadamente y explicar por qué es importante. ', maxPoints: 25,
          levels: [
            { label: 'Insuficiente', minPoints: 0, maxPoints: 6, description: 'El problema está formulado de manera vaga, genérica o confusa. No queda claro qué situación concreta se busca atender, a quién afecta ni por qué constituye un problema democrático relevante. Puede confundirse el problema con la solución o presentarse como una afirmación amplia sin delimitación.' },
            { label: 'Suficiente', minPoints: 7, maxPoints: 12, description: 'El problema se identifica de manera general, pero todavía con poca precisión o escasa delimitación. Se reconoce parcialmente a quién afecta y se ofrece alguna justificación de su importancia, aunque el contexto sigue siendo débil, incompleto o poco profundo.' },
            { label: 'Satisfactorio', minPoints: 13, maxPoints: 19, description: 'El problema está claramente planteado, con un contexto reconocible y una explicación razonable de su importancia. Se identifica a la población afectada y la situación en la que ocurre. Aunque podría profundizar más en causas o matices, existe una comprensión sólida del reto democrático planteado.' },
            { label: 'Destacado', minPoints: 20, maxPoints: 25, description: 'El problema está formulado con alta precisión, claramente contextualizado y sólidamente argumentado. Se distingue con claridad qué ocurre, a quién afecta, en qué contexto y por qué su atención es relevante para la vida democrática. La descripción revela comprensión profunda del problema y evita generalidades.' }
          ]
        },
        {
          label: '2. Relevancia e impacto (0–20 puntos) La importancia pública del problema y el potencial de la propuesta para generar un cambio significativo en la ciudadanía o en el funcionamiento democrático.', maxPoints: 20,
          levels: [
            { label: 'Insuficiente', minPoints: 0, maxPoints: 5, description: 'El problema parece marginal, poco claro o de baja incidencia pública. No se alcanza a ver su impacto real en la ciudadanía, en las instituciones o en los procesos democráticos. La justificación del cambio esperado es débil o inexistente.' },
            { label: 'Suficiente', minPoints: 6, maxPoints: 10, description: 'El problema muestra cierta relevancia, pero su impacto no está claramente desarrollado. Se percibe que podría tener implicaciones públicas, aunque la explicación sobre sus efectos o el valor de atenderlo sigue siendo limitada, superficial o poco convincente.' },
            { label: 'Satisfactorio', minPoints: 11, maxPoints: 15, description: 'El problema tiene relevancia clara y se explica de forma suficiente su importancia para la ciudadanía o para el sistema democrático. Se identifica razonablemente el valor público de atenderlo y el potencial de generar mejoras tangibles o significativas.' },
            { label: 'Destacado', minPoints: 16, maxPoints: 20, description: 'El problema presenta alta relevancia pública y se justifica de manera convincente su impacto sobre derechos, participación, acceso, confianza, inclusión o funcionamiento institucional. La propuesta muestra fuerte potencial de generar cambio significativo y de atender una necesidad importante del ecosistema democrático.' }
          ]
        },
        {
          label: '3. Coherencia solución–problema (0–20 puntos) La lógica interna de la propuesta: si la solución responde realmente al problema identificado y si existe coherencia entre problema, usuario, contexto y propuesta tecnológica.', maxPoints: 20,
          levels: [
            { label: 'Insuficiente', minPoints: 0, maxPoints: 5, description: 'La solución no responde claramente al problema identificado o existe una desconexión evidente entre ambos. No se entiende bien quién usaría la solución, cómo se utilizaría o por qué resolvería el problema. La propuesta luce forzada, genérica o desalineada.' },
            { label: 'Suficiente', minPoints: 6, maxPoints: 10, description: 'La solución guarda cierta relación con el problema, pero su lógica aún es parcial o débil. El vínculo entre problema, usuario y contexto existe, aunque no está suficientemente explicado o resulta poco convincente. Persisten dudas sobre su pertinencia real.' },
            { label: 'Satisfactorio', minPoints: 11, maxPoints: 15, description: 'La solución responde de manera clara al problema planteado. Existe una relación lógica entre la necesidad identificada, el usuario objetivo y el contexto de aplicación. La propuesta es consistente, aunque todavía podría ganar precisión en su funcionamiento o en el valor específico que genera.' },
            { label: 'Destacado', minPoints: 16, maxPoints: 20, description: 'La solución está plenamente alineada con el problema y su diseño demuestra coherencia conceptual robusta. Se entiende con claridad quién la usaría, en qué contexto, cómo operaría y por qué resulta pertinente. La relación entre problema y solución es directa, convincente y bien articulada.' }
          ]
        },
        {
          label: '4. Viabilidad en 48 horas (0–20 puntos) El realismo del alcance propuesto para el hackathon, la claridad del MVP y la posibilidad concreta de desarrollar un prototipo funcional en dos días.', maxPoints: 20,
          levels: [
            { label: 'Insuficiente', minPoints: 0, maxPoints: 5, description: 'El alcance propuesto es irreal, desproporcionado o indefinido para un hackathon de 48 horas. No queda claro qué se prototipará ni qué se espera tener funcionando al final. La propuesta depende de desarrollos excesivos, complejos o poco aterrizados.' },
            { label: 'Suficiente', minPoints: 6, maxPoints: 10, description: 'Existe una intención de acotar el proyecto, pero el alcance todavía presenta ambigüedad o elementos difíciles de ejecutar en el tiempo disponible. Se menciona un entregable posible, aunque sin suficiente precisión sobre qué estará realmente funcionando.' },
            { label: 'Satisfactorio', minPoints: 11, maxPoints: 15, description: 'El equipo plantea un alcance razonable para 48 horas. Se identifica con claridad qué se va a prototipar y cuál será el resultado funcional esperado al final del hackathon. Aun cuando subsisten algunos retos, la propuesta luce realizable.' },
            { label: 'Destacado', minPoints: 16, maxPoints: 20, description: 'La propuesta muestra un excelente nivel de aterrizaje y priorización. El equipo define con precisión qué construirá, qué funcionalidad mínima operará al final y por qué ese alcance sí puede lograrse en 48 horas. Se aprecia pensamiento estratégico de MVP y alta factibilidad operativa.' }
          ]
        },
        {
          label: '5. Uso estratégico de tecnología (0–15 puntos) La pertinencia de la tecnología seleccionada, la claridad de su uso y el valor real que aporta a la solución.', maxPoints: 15,
          levels: [
            { label: 'Insuficiente', minPoints: 0, maxPoints: 3, description: 'La tecnología propuesta no se explica con claridad, parece irrelevante para el problema o se menciona solo como palabra clave. No se entiende cómo aporta valor a la solución o por qué sería necesaria.' },
            { label: 'Suficiente', minPoints: 4, maxPoints: 7, description: 'La propuesta tecnológica tiene cierta relación con la solución, pero la explicación de su uso es limitada, superficial o incompleta. La tecnología parece útil, aunque no queda del todo claro por qué fue elegida o qué valor diferencial aporta.' },
            { label: 'Satisfactorio', minPoints: 8, maxPoints: 11, description: 'La tecnología seleccionada es pertinente y su uso está explicado de manera clara. Se entiende cómo contribuye a resolver el problema y por qué tiene sentido dentro de la solución planteada. Aunque podría profundizar más, existe buen criterio tecnológico.' },
            { label: 'Destacado', minPoints: 12, maxPoints: 15, description: 'La tecnología está elegida con alto nivel de pertinencia y claridad estratégica. Su uso es completamente coherente con el problema, el usuario y el contexto, y aporta valor real a la solución. No hay artificio tecnológico: la herramienta se utiliza porque efectivamente fortalece la propuesta.' }
          ]
        }
      ]
    }
  ]
};

export function seedIfEmpty() {
  if (listHackathons({ includeArchived: true }).length > 0) return;

  console.log('🗳️ Creating Ciberdemocracia hackathon...');
  const hack = createHackathon({
    name: 'Hackatón Ciberdemocracia 2026',
    description: 'Fomentando la participación ciudadana a través de la tecnología.',
  });

  const tpl = createTemplate({ hackathonId: hack.id, ...CIBERDEMOCRACIA_RUBRIC });
  console.log(`   ✓ Rubric "${tpl.name}" loaded (${tpl.totalMaxPoints} pts total)`);

  // Ajusta las fases según el proceso de selección que necesites
  createPhase({ hackathonId: hack.id, name: 'Evaluación de Propuestas', templateId: tpl.id });
  createPhase({ hackathonId: hack.id, name: 'Pitch Final', templateId: tpl.id });
  
  console.log('   ✓ Phases: Evaluación de Propuestas, Pitch Final\n');
}