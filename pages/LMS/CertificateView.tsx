import React from 'react';
import { Certificate } from '../../types/lms';
import { AwardIcon, PrinterIcon, CheckCircleIcon } from 'lucide-react';

interface Props {
    certificate: Certificate;
}

/**
 * Renders an earned course certificate and lets the learner print/export it to
 * PDF. The verification code makes the certificate auditable.
 */
export const CertificateCard: React.FC<Props> = ({ certificate }) => {
    const issued = new Date(certificate.issuedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

    const handlePrint = () => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow?.document;
        if (doc) {
            doc.write(`
                <html><head><title>Certificado - ${certificate.courseTitle}</title>
                <style>
                  body{font-family:Georgia,serif;margin:0;padding:60px;color:#1e1b4b;}
                  .frame{border:6px double #4f46e5;border-radius:16px;padding:60px 50px;text-align:center;}
                  .eyebrow{letter-spacing:6px;text-transform:uppercase;font-size:13px;color:#6366f1;font-family:Arial,sans-serif;}
                  h1{font-size:42px;margin:18px 0 6px;}
                  .name{font-size:32px;margin:30px 0 8px;border-bottom:2px solid #c7d2fe;display:inline-block;padding:0 30px 8px;}
                  .course{font-size:22px;font-weight:bold;margin:24px 0;}
                  .meta{display:flex;justify-content:space-between;margin-top:60px;font-family:Arial,sans-serif;font-size:13px;color:#475569;}
                </style></head><body>
                <div class="frame">
                  <div class="eyebrow">Arky Academy</div>
                  <h1>Certificado de Finalización</h1>
                  <p>Se otorga el presente certificado a</p>
                  <div class="name">${certificate.userName}</div>
                  <p>por completar exitosamente el curso</p>
                  <div class="course">${certificate.courseTitle}</div>
                  ${certificate.scorePercent !== undefined ? `<p>Calificación promedio: <strong>${certificate.scorePercent}%</strong></p>` : ''}
                  <div class="meta">
                    <span>Emitido: ${issued}</span>
                    <span>Verificación: ${certificate.verificationCode}</span>
                  </div>
                </div>
                <script>window.onload=function(){setTimeout(function(){window.print();},400);}</script>
                </body></html>
            `);
            doc.close();
            setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 5000);
        }
    };

    return (
        <div className="relative overflow-hidden rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 p-6 shadow-sm">
            <div className="absolute top-0 right-0 -mt-8 -mr-8 opacity-10 pointer-events-none">
                <AwardIcon className="h-40 w-40 text-indigo-600" />
            </div>
            <div className="relative z-10">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-3">
                    <CheckCircleIcon className="h-5 w-5" />
                    <span className="text-xs font-bold uppercase tracking-wider">Certificado obtenido</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{certificate.courseTitle}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Otorgado a <span className="font-semibold text-gray-800 dark:text-gray-200">{certificate.userName}</span>
                    {certificate.scorePercent !== undefined && <> · Promedio <span className="font-semibold">{certificate.scorePercent}%</span></>}
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-gray-400 mb-5">
                    <span>Emitido: {issued}</span>
                    <span className="font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">{certificate.verificationCode}</span>
                </div>
                <button
                    onClick={handlePrint}
                    className="inline-flex items-center px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
                >
                    <PrinterIcon className="h-4 w-4 mr-2" /> Descargar / Imprimir
                </button>
            </div>
        </div>
    );
};
