import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useLMS } from '../hooks/useLMS';
import { UploadedFile, ChatModalPurpose } from '../types';
import type { ChatMessage } from '../services/chat';
import { createChatMessage } from '../services/chat';
import {
  AIServiceError,
  assistantService,
  classifyAIError,
  getAiBlockingCooldownRemainingMs,
  sendGuidedProjectCreationMessage,
} from '../services/ai';
import { MicrophoneIcon, PaperClipIcon, XCircleIcon, CheckCircleIcon, ArrowRightIcon } from './Icons';
import { Copy, Check } from 'lucide-react';

import { getFileIcon } from '../utils';
import { SafeRichText } from './ui/SafeRichText';
import type { GuidedProjectData } from '../services/ai';
import { finalTranscriptFrom, getSpeechRecognition, type SpeechRecognitionInstance } from '../lib/speechRecognition';

interface ChatInterfaceProps {
  onComplete?: (data: GuidedProjectData) => void;
  purpose: ChatModalPurpose;
  initialPrompt: string;
  projectId?: string; // ID para persistencia
  contextData?: string; // Contexto extra (ej. contenido de un artefacto)
  heightClass?: string;
}

const fileToGenerativePart = async (file: File): Promise<UploadedFile> => {
    const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        name: file.name,
        type: file.type,
        base64Data,
    };
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    onComplete, 
    purpose, 
    initialPrompt,
    projectId,
    contextData,
    heightClass = "h-[70vh]"
}) => {
  const { projects, settings, t, loadChatHistory, saveChatHistory, getProject } = useAppContext();
  const { courses } = useLMS();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingProjectData, setPendingProjectData] = useState<GuidedProjectData | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
  const [cooldownNotice, setCooldownNotice] = useState<string | null>(null);

  const handleCopyMessage = (content: string, index: number) => {
      navigator.clipboard.writeText(content).then(() => {
          setCopiedIndex(index);
          setTimeout(() => setCopiedIndex(null), 2000);
      });
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isMounted = useRef(true);
  const sendLockRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
      isMounted.current = true;
      return () => {
          isMounted.current = false;
          abortControllerRef.current?.abort();
      };
  }, []);

  // El saludo inicial y el lector de historial se leen por referencia. El
  // primero, porque cambiar el texto no debe reiniciar un chat en curso —que
  // es lo que pasaba cuando `initialPrompt` estaba en las dependencias—. El
  // segundo, porque su identidad depende de quién provea el contexto: un
  // proveedor que no memorice `loadChatHistory` haría que el efecto se
  // reejecutara en cada render y recargara el historial sin parar.
  const initialPromptRef = useRef(initialPrompt);
  initialPromptRef.current = initialPrompt;
  const loadChatHistoryRef = useRef(loadChatHistory);
  loadChatHistoryRef.current = loadChatHistory;

  // Inicialización del Chat (Carga de Historial o Prompt Inicial)
  useEffect(() => {
    const initChat = async () => {
        if (projectId && purpose === 'project-chat') {
            // Modo Persistente: Cargar historial
            setIsLoading(true);
            try {
                const history = await loadChatHistoryRef.current(projectId);
                if (isMounted.current) {
                    let loadedMessages = history;
                    
                    // Si no hay historial, iniciar con el saludo del arquitecto
                    if (loadedMessages.length === 0) {
                        loadedMessages = [createChatMessage('model', initialPromptRef.current)];
                    } 
                    
                    // Inyección de Contexto (si se abre desde un artefacto)
                    if (contextData) {
                        const contextMessage = `[Contexto del Sistema]: El usuario está visualizando la siguiente información para su consulta:\n\n${contextData}`;
                        
                        // Chequeo de calidad: Evitar duplicar el contexto si es idéntico al último mensaje
                        // (por si el usuario abre y cierra el modal varias veces sobre el mismo artefacto)
                        const lastMsg = loadedMessages[loadedMessages.length - 1];
                        if (!lastMsg || lastMsg.content !== contextMessage) {
                            loadedMessages = [...loadedMessages, createChatMessage('user', contextMessage)];
                        }
                    }
                    
                    setMessages(loadedMessages);
                }
            } catch (e) {
                console.error("Error loading chat history", e);
            } finally {
                if (isMounted.current) setIsLoading(false);
            }
        } else {
            // Chat Efímero (Creación Guiada, Análisis)
            setMessages([createChatMessage('model', initialPromptRef.current)]);
        }
    };

    initChat();
  }, [projectId, purpose, contextData]);

  useEffect(() => {
      if (purpose !== 'guided-creation') return;
      const updateCooldown = () => {
          const remaining = getAiBlockingCooldownRemainingMs('guided-creation');
          setCooldownRemainingMs(remaining);
          if (remaining <= 0) setCooldownNotice(null);
      };
      updateCooldown();
      const intervalId = window.setInterval(updateCooldown, 1000);
      return () => window.clearInterval(intervalId);
  }, [purpose]);

  // Auto-scroll al final
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Guardado Automático del Historial
  useEffect(() => {
      if (projectId && messages.length > 0 && purpose === 'project-chat') {
          saveChatHistory(projectId, messages);
      }
  }, [messages, projectId, purpose, saveChatHistory]);

  const handleSendMessage = async () => {
    if ((!userInput.trim() && uploadedFiles.length === 0) || isLoading || sendLockRef.current || cooldownRemainingMs > 0) return;

    sendLockRef.current = true;
    const currentInput = userInput;
    const currentFiles = purpose === 'guided-creation' ? [] : [...uploadedFiles];
    const abortController = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = abortController;
    
    let userMessageContent = currentInput;
    if (currentFiles.length > 0) {
        const fileNames = currentFiles.map(f => f.name).join(', ');
        userMessageContent += `\n\n*Archivos adjuntos: ${fileNames}*`;
    }
    
    const newMessages = [...messages, createChatMessage('user', userMessageContent)];
    setMessages(newMessages);
    
    setUserInput('');
    setUploadedFiles([]);
    setIsLoading(true);

    try {
        // Obtener objeto del proyecto completo para contexto si es chat persistente
        let projectContextObj = undefined;
        if (projectId) {
            projectContextObj = getProject(projectId);
        }

        let aiResponse = "";
        
        if (purpose === 'guided-creation') {
             const result = await sendGuidedProjectCreationMessage(newMessages, currentInput, settings, abortController.signal);
             setCooldownNotice(null);
             setCooldownRemainingMs(0);
             aiResponse = result.text;
             if (result.command) {
                 setPendingProjectData(result.command.data);
                 const summary = `¡Excelente! He recopilado la información necesaria.\n\n**Proyecto:** ${result.command.data.name}\n**Descripción:** ${result.command.data.description}\n\nVoy a generar los siguientes artefactos iniciales:\n- ${result.command.data.initialArtifacts.join('\n- ')}\n\n¿Procedo con la creación?`;
                 setMessages(prev => [...prev, createChatMessage('model', summary)]);
                 return;
             }
        } else if (purpose === 'project-chat' && projectContextObj) {
             if (contextData) {
                 // Usar método específico para asistente de proyecto con contexto de artefacto
                 const result = await assistantService.processAssistantChat(
                     projectContextObj, 
                     null, 
                     newMessages, 
                     currentInput, 
                     settings
                 );
                 aiResponse = result.text;
             } else {
                 // Usar chat global del proyecto
                 const history = newMessages.map(m => ({ role: m.role as 'user' | 'model', parts: [{ text: m.content }] }));
                 aiResponse = await assistantService.chatWithProject(
                     projectContextObj,
                     currentInput,
                     history,
                     settings
                 );
             }
        } else {
             // Usar chat multimodal estándar
             aiResponse = await assistantService.processMultimodalChat(purpose, newMessages, currentInput, currentFiles, settings, projects, courses);
        }

        if (isMounted.current) {
            // Detección de Comandos (solo para Creación Guiada)
            let isCommand = false;
            if (purpose !== 'project-chat' && purpose !== 'guided-creation') {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const jsonString = jsonMatch[0];
                        const parsedResponse = JSON.parse(jsonString);
                        if (parsedResponse.action === 'createProject' && parsedResponse.data) {
                            setPendingProjectData(parsedResponse.data);
                            const summary = `¡Excelente! He recopilado la información necesaria.\n\n**Proyecto:** ${parsedResponse.data.name}\n**Descripción:** ${parsedResponse.data.description}\n\nVoy a generar los siguientes artefactos iniciales:\n- ${parsedResponse.data.initialArtifacts.join('\n- ')}\n\n¿Procedo con la creación?`;
                            setMessages(prev => [...prev, createChatMessage('model', summary)]);
                            isCommand = true;
                        }
                    } catch (_e) {
                        // Ignorar errores de parseo si es charla normal
                    }
                }
            }

            if (!isCommand) {
                setMessages(prev => [...prev, createChatMessage('model', aiResponse)]);
            }
        }

    } catch (error) {
        const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
        console.error('[ChatInterface] failed', { category: friendly.category, status: friendly.status, source: friendly.source, errorCode: friendly.errorCode });
        if (isMounted.current) {
            const headline = friendly.category === 'overloaded' ? '⚠️ Modelo saturado'
                : friendly.category === 'rate-limit' && friendly.source === 'proxy-local-rate-limit' ? '⚠️ Canal de IA limitado'
                : friendly.category === 'rate-limit' ? '⚠️ Límite de Gemini alcanzado'
                : friendly.category === 'auth' ? '⚠️ Autenticación'
                : friendly.category === 'timeout' ? '⚠️ Tiempo agotado'
                : friendly.category === 'network' ? '⚠️ Sin conexión'
                : '⚠️ Error temporal';
            const retryAfterSeconds = friendly.retryAfterMs ? Math.ceil(friendly.retryAfterMs / 1000) : Math.ceil(getAiBlockingCooldownRemainingMs(purpose === 'guided-creation' ? 'guided-creation' : 'project-chat') / 1000);
            if (friendly.category === 'rate-limit' && retryAfterSeconds > 0) {
                setCooldownRemainingMs(retryAfterSeconds * 1000);
                setCooldownNotice(`${headline}. ${friendly.userMessage} Puedes reintentar en ${retryAfterSeconds} segundos sin cerrar esta ventana.`);
                return;
            }
            const retryHint = friendly.retryable ? '\n\nVuelve a enviar tu mensaje y lo intentaré de nuevo.' : '';
            setMessages(prev => [...prev, createChatMessage('model', `${headline}\n\n${friendly.userMessage}${retryHint}`)]);
        }
    } finally {
        if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
        }
        if (isMounted.current) setIsLoading(false);
        sendLockRef.current = false;
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
        const files = Array.from(event.target.files);
        const generativeParts = await Promise.all(files.map(fileToGenerativePart));
        setUploadedFiles(prev => [...prev, ...generativeParts]);
    }
    event.target.value = '';
  };
  
  const handleMicClick = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      console.error("El reconocimiento de voz no es compatible con este navegador.");
      return;
    }
    
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = settings.language === 'es' ? 'es-ES' : 'en-US';
    recognitionRef.current.interimResults = true;
    recognitionRef.current.continuous = true;

    recognitionRef.current.onstart = () => setIsRecording(true);
    recognitionRef.current.onend = () => setIsRecording(false);
    recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsRecording(false);
    };

    recognitionRef.current.onresult = (event) => {
        setUserInput(prev => prev + finalTranscriptFrom(event));
    };
    
    recognitionRef.current.start();
  };
  
  const handleConfirmCreation = () => {
    if (pendingProjectData && onComplete) {
        onComplete(pendingProjectData);
        setPendingProjectData(null);
    }
  };

  const handleCancelCreation = () => {
      setPendingProjectData(null);
      setMessages(prev => [...prev, createChatMessage('model', "De acuerdo, he cancelado la creación. ¿Cómo te gustaría continuar?")]);
  };

  return (
      <div className={`flex flex-col ${heightClass}`}>
        <div className="flex-grow overflow-y-auto pr-4 space-y-4">
          {messages.map((msg, index) => {
             // Ocultar mensajes de sistema en la UI para limpieza visual, pero se mantienen en la lógica
             if (msg.content.startsWith('[Contexto del Sistema]')) return null;

             return (
                <div key={index} className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`p-3 rounded-xl max-w-[85%] relative ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-br-sm' : 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-sm'}`}>
                    <SafeRichText className="prose prose-sm dark:prose-invert max-w-none break-words" markdown={msg.content} />
                    {msg.role === 'model' && !pendingProjectData && (
                        <button
                            onClick={() => handleCopyMessage(msg.content, index)}
                            className="absolute -bottom-6 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                            aria-label="Copiar mensaje"
                        >
                            {copiedIndex === index ? (
                                <><Check className="h-3 w-3" /> Copiado</>
                            ) : (
                                <><Copy className="h-3 w-3" /> Copiar</>
                            )}
                        </button>
                    )}
                    {pendingProjectData && index === messages.length - 1 && (
                        <div className="mt-4 pt-3 border-t border-gray-300 dark:border-gray-600 flex items-center justify-end space-x-3">
                            <button
                                onClick={handleCancelCreation}
                                className="px-4 py-2 flex items-center bg-gray-500 text-white rounded-lg hover:bg-gray-600 font-semibold text-sm active:scale-[0.98] transition-all"
                            >
                                <XCircleIcon className="h-5 w-5 mr-2" />
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmCreation}
                                className="px-4 py-2 flex items-center bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold text-sm active:scale-[0.98] transition-all"
                            >
                                <CheckCircleIcon className="h-5 w-5 mr-2" />
                                Confirmar y Crear
                            </button>
                        </div>
                    )}
                </div>
                </div>
             );
          })}
          {isLoading && (
            <div className="flex justify-start">
               <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-bl-sm">
                  <div className="flex items-center gap-1">
                    <div className="h-2 w-2 bg-primary-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="h-2 w-2 bg-primary-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="h-2 w-2 bg-primary-500 rounded-full animate-bounce"></div>
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">Pensando...</span>
                  </div>
                </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        
        {uploadedFiles.length > 0 && (
            <div className="mt-2 p-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
                {uploadedFiles.map((file, index) => (
                    <div key={index} className="bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-1.5 text-sm flex items-center gap-2 border border-gray-200 dark:border-gray-600">
                        <span className="text-base">{getFileIcon(file.type)}</span>
                        <span className="text-gray-700 dark:text-gray-300 truncate max-w-[150px]">{file.name}</span>
                        <button onClick={() => setUploadedFiles(files => files.filter(f => f.name !== file.name))} className="ml-1 flex-shrink-0">
                            <XCircleIcon className="h-4 w-4 text-gray-400 hover:text-red-500 transition-colors"/>
                        </button>
                    </div>
                ))}
            </div>
        )}

        {cooldownRemainingMs > 0 && cooldownNotice && (
            <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200" role="status" aria-live="polite">
                {cooldownNotice.replace(/\.$/, '')}. Reintento disponible en {Math.ceil(cooldownRemainingMs / 1000)} segundos.
            </p>
        )}

        <div className="mt-4 flex items-center border border-gray-300 dark:border-gray-600 rounded-xl focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-400 bg-white dark:bg-gray-800 transition-all">
          <button onClick={() => fileInputRef.current?.click()} title="Adjuntar archivo" className="p-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 hover:text-primary-600 dark:hover:text-primary-400" disabled={!!pendingProjectData}>
            <PaperClipIcon className="h-5 w-5"/>
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />

          <button onClick={handleMicClick} title="Usar micrófono" className={`p-3 min-w-[44px] min-h-[44px] flex items-center justify-center ${isRecording ? 'text-red-500 animate-pulse' : 'text-gray-500 hover:text-primary-600 dark:hover:text-primary-400'}`} disabled={!!pendingProjectData}>
            <MicrophoneIcon className="h-5 w-5"/>
          </button>

          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendMessage();
                }
            }}
            placeholder={purpose === 'project-chat' ? "Consulta al arquitecto o pide cambios..." : t('respondHere')}
            className="flex-grow px-4 py-3 bg-transparent focus:outline-none text-sm min-h-[44px]"
            disabled={isLoading || !!pendingProjectData || cooldownRemainingMs > 0}
          />
          <button onClick={() => void handleSendMessage()} disabled={isLoading || !!pendingProjectData || cooldownRemainingMs > 0 || (!userInput.trim() && uploadedFiles.length === 0)} className="p-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-primary-600 hover:text-primary-700 disabled:text-gray-400">
            <ArrowRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
  );
};
