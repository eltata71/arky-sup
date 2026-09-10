
import React, { useState } from 'react';
import { SmartNote } from '../../types/lms';
import { BrainCircuitIcon, TrashIcon, BookOpenIcon, ArrowRightIcon, XIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { SafeRichText } from '../../components/ui/SafeRichText';


interface Props {
    notes: SmartNote[];
    onDelete: (id: string) => void;
}

export const LMSSmartNotes: React.FC<Props> = ({ notes, onDelete }) => {
    // Flashcard-style review mode (active recall): the note's metadata is shown
    // as the prompt and the content is hidden until the student chooses to
    // reveal it. Wires up the previously dead "Repasar Concepto" button.
    const [reviewIndex, setReviewIndex] = useState<number | null>(null);
    const [revealed, setRevealed] = useState(false);

    const openReview = (index: number) => {
        setReviewIndex(index);
        setRevealed(false);
    };

    const moveReview = (delta: number) => {
        setReviewIndex(prev => {
            if (prev === null) return prev;
            const next = (prev + delta + notes.length) % notes.length;
            return next;
        });
        setRevealed(false);
    };

    const reviewNote = reviewIndex !== null ? notes[reviewIndex] : null;

    return (
        <div className="animate-fade-in space-y-8 max-w-7xl mx-auto">
            <div className="bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center space-x-4">
                    <div className="w-16 h-16 bg-pink-50 dark:bg-pink-900/30 rounded-2xl flex items-center justify-center shadow-inner">
                        <BrainCircuitIcon className="h-8 w-8 text-pink-500" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Segundo Cerebro</h2>
                        <p className="text-gray-500 dark:text-gray-400">Tus notas inteligentes y conceptos clave guardados.</p>
                    </div>
                </div>
                <div className="bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 px-4 py-2 rounded-xl font-bold text-sm flex items-center shadow-sm">
                    <BookOpenIcon className="h-4 w-4 mr-2" />
                    {notes.length} {notes.length === 1 ? 'Nota' : 'Notas'}
                </div>
            </div>

            {notes.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-gray-900 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center">
                    <div className="w-24 h-24 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-6">
                        <BrainCircuitIcon className="h-12 w-12 text-gray-400" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Aún no tienes notas</h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md">
                        Mientras tomas cursos, puedes generar notas ultracortas con IA y guardarlas aquí para construir tu segundo cerebro.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {notes.map((note, index) => (
                        <div key={note.id} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group flex flex-col h-full relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            
                            <div className="flex justify-between items-start mb-4">
                                <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                    {new Date(note.createdAt).toLocaleDateString()}
                                </span>
                                <button 
                                    onClick={() => onDelete(note.id)}
                                    className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="Eliminar nota"
                                >
                                    <TrashIcon className="h-4 w-4" />
                                </button>
                            </div>
                            
                            <div className="prose prose-sm dark:prose-invert max-w-none flex-grow mb-6 prose-p:leading-relaxed">
                                <SafeRichText markdown={note.content} />
                            </div>
                            
                            <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                                <button onClick={() => openReview(index)} className="w-full flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors group/btn">
                                    Repasar Concepto <ArrowRightIcon className="h-4 w-4 ml-1.5 group-hover/btn:translate-x-1 transition-transform" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Flashcard Review Modal */}
            {reviewNote && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-gray-900/70 backdrop-blur-sm" onClick={() => setReviewIndex(null)} />
                    <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl ring-1 ring-gray-900/5 dark:ring-white/10 overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-400 to-purple-500" />
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                                        Repaso · {reviewIndex! + 1}/{notes.length}
                                    </span>
                                    <span className="text-xs text-gray-400">{new Date(reviewNote.createdAt).toLocaleDateString()}</span>
                                </div>
                                <button onClick={() => setReviewIndex(null)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <XIcon className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="min-h-[200px] flex flex-col items-center justify-center text-center">
                                <BrainCircuitIcon className="h-10 w-10 text-pink-400 mb-3" />
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Concepto de</p>
                                <p className="text-lg font-bold text-gray-900 dark:text-white mb-6">{reviewNote.tabId}</p>

                                {revealed ? (
                                    <div className="w-full text-left prose prose-sm dark:prose-invert max-w-none bg-gray-50 dark:bg-gray-800/50 rounded-xl p-5 border border-gray-100 dark:border-gray-800 animate-fade-in">
                                        <SafeRichText markdown={reviewNote.content} />
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setRevealed(true)}
                                        className="flex items-center px-6 py-3 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-md"
                                    >
                                        <EyeIcon className="h-5 w-5 mr-2" /> Mostrar respuesta
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                                <button
                                    onClick={() => moveReview(-1)}
                                    disabled={notes.length <= 1}
                                    className="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
                                >
                                    <ChevronLeftIcon className="h-4 w-4 mr-1" /> Anterior
                                </button>
                                {revealed && (
                                    <button
                                        onClick={() => setRevealed(false)}
                                        className="flex items-center px-3 py-2 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <EyeOffIcon className="h-4 w-4 mr-1.5" /> Ocultar
                                    </button>
                                )}
                                <button
                                    onClick={() => moveReview(1)}
                                    disabled={notes.length <= 1}
                                    className="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
                                >
                                    Siguiente <ChevronRightIcon className="h-4 w-4 ml-1" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
