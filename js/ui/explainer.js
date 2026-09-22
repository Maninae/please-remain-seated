/**
 * "How this works" collapse. Six bullets on the model with links to the spec and research doc.
 * Static content; nothing dynamic here beyond the mode-aware bullet about which state machine is
 * on screen.
 */

export function mountExplainer({ store }) {
  const body = document.getElementById('explainer-body');
  if (!body) return;
  render(store.state());
  store.subscribe(render);

  function render(state) {
    const modeLine = state.mode === 'deplane'
      ? 'Deplaning today: prep timer runs from door-open, then anyone READY can stand if their row-mates are out and the aisle cell beside them is free.'
      : 'Boarding today: passengers arrive at the door on an exponential inter-arrival, walk aft, and stow at their bin (or the next one with space).';
    body.innerHTML = `
      <ul>
        <li>${modeLine}</li>
        <li>Every bag retrieval blocks its aisle cell. Nothing behind a stopped person moves. That is the whole story.</li>
        <li>Walking speed 0.8 m/s, prep 1-2 s, bag retrieval Weibull(1.7, 10 s), stow Weibull(1.7, 16 s). Numbers from Schultz 2018 and Milne &amp; Salari 2016 with a distracted tail we assumed.</li>
        <li>Compliance and families are the killers. Free-for-all is what actually happens; the classroom-optimal orderings assume everybody plays along.</li>
        <li>Two doors halve deplaning time by roughly what you would expect: two aisles instead of one.</li>
        <li>Every strategy above rides the same physics. Change the sliders and the winner may flip; this is why airlines cannot promise a boarding time.</li>
      </ul>
      <p>Spec: <a href="https://github.com/Maninae/please-remain-seated/blob/main/design/01-spec.md" target="_blank" rel="noopener">design/01-spec.md</a> · Research: <a href="https://github.com/Maninae/please-remain-seated/blob/main/design/02-research.md" target="_blank" rel="noopener">design/02-research.md</a></p>
    `;
  }
}
