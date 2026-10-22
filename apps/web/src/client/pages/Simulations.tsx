import { LinkButton, usePageTitle } from '../../shared/ui';
import { SimHistory } from '../simProposal';

/** Histórico de simulações de financiamento da pessoa. */
export default function Simulations() {
  usePageTitle('Minhas simulações');
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Minhas simulações</h1><p>Veja de novo, baixe o PDF ou imprima as simulações que você salvou.</p></div><LinkButton to="/simulador" variant="primary" icon="calculator">Nova simulação</LinkButton></div>
      <SimHistory />
    </div>
  );
}
