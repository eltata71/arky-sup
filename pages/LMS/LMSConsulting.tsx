
import React, { useState } from 'react';
import { assistantService } from '../../services/ai';
import { useAppContext } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { LightbulbIcon, MessageSquareIcon, SparklesIcon } from 'lucide-react';
import { SafeRichText } from '../../components/ui/SafeRichText';
import { errorMessageOf } from '../../lib/errorMessage';


export const LMSConsulting: React.FC = () => {
    const { settings } = useAppContext();
    const { addToast } = useToast();
    const [challenge, setChallenge] = useState('');
    const [response, setResponse] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const handleConsult = async () => {
        if (!challenge.trim()) return;
        setIsAnalyzing(true);
        try {
            const res = await assistantService.consultArchitecture(challenge, settings);
            setResponse(res);
        } catch (error) {
            console.error(error);
            addToast(errorMessageOf(error, 'Error en la consultoría. Revisa tu conexión o la API Key.'), 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto animate-fade-in space-y-8">
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center space-x-4 mb-6">
                    <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center shadow-inner">
                        <LightbulbIcon className="h-8 w-8 text-amber-500" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Consultoría de Arquitectura IA</h2>
                        <p className="text-gray-500 dark:text-gray-400">Describe tu desafío arquitectónico y recibe una propuesta estratégica estructurada.</p>
                    </div>
                </div>
                
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wider">Tu Desafío</label>
                    <textarea 
                        value={challenge}
                        onChange={e => setChallenge(e.target.value)}
                        placeholder="Ej. Necesitamos migrar un monolito legacy a microservicios pero tenemos una base de datos altamente acoplada..."
                        className="w-full h-40 p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-6 text-base resize-none shadow-sm"
                    />
                    <div className="flex justify-end">
                        <button 
                            onClick={handleConsult}
                            disabled={isAnalyzing || !challenge.trim()}
                            className="bg-indigo-600 text-white px-8 py-3.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 flex items-center group"
                        >
                            {isAnalyzing ? (
                                <span className="flex items-center">
                                    <SparklesIcon className="h-5 w-5 mr-2 animate-spin" /> Analizando...
                                </span>
                            ) : (
                                <span className="flex items-center">
                                    <MessageSquareIcon className="h-5 w-5 mr-2 group-hover:scale-110 transition-transform" /> Consultar IA
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {response && (
                <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-indigo-500"></div>
                    <div className="flex items-center mb-6 text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider text-sm">
                        <SparklesIcon className="h-5 w-5 mr-2" />
                        Respuesta de la IA
                    </div>
                    <div className="prose prose-indigo dark:prose-invert max-w-none prose-headings:font-bold prose-h3:text-xl prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-li:text-gray-600 dark:prose-li:text-gray-300">
                        <SafeRichText markdown={response} />
                    </div>
                </div>
            )}
        </div>
    );
};
