import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// Configuration constants
const PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'your_pinecone_key';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'your_openai_key';
const DIMENSION = 1024;
const DEFAULT_INDEX = 'horizonblue';

// Interface definitions
interface RAGResponse {
    type: 'ai_response' | 'error';
    message: string;
    metadata?: {
        context?: string;
        confidence: number;
        planName?: string;
    };
}
const AKNOWLEDGE = `AmeriHealth Platinum provides in-network coverage for various medical services but does not cover out-of-network care. Physician visits for injury or illness require a $10 copayment. Diagnostic tests include a $30 copay for X-rays and no charge for blood work. Imaging services, including CT/PET scans and MRIs, require a $60 copay per scan and prior authorization. Generic drugs cost $15 per fill for a 30-day supply and $30 for a 90-day supply, with prior authorization required for some medications. Outpatient surgery is covered at no charge but requires prior authorization for certain procedures. Emergency room visits have a $100 copayment. Pregnancy and childbirth services have no charge, with no cost-sharing for preventive services. Durable medical equipment requires 50% coinsurance, with prior authorization needed for selected items. For full details, visit AmeriHealth Platinum Member Services.`;
const OHKNOwLEDGE = `UnitedHealthcare Oxford covers essential medical services with in-network cost-sharing but no out-of-network coverage. Physician visits for injury/illness require a $10 copayment. Diagnostic tests include a $60 copay for X-rays and no charge for blood work. Imaging (CT/PET/MRIs) costs $10 per scan. Generic drugs have a $5 copay for a 30-day supply and $10 for a 90-day supply, requiring prior authorization. Outpatient surgery requires a $500 copay per service. Emergency room visits cost $100 per visit, regardless of network status. Pregnancy and childbirth professional services have no charge, with no cost-sharing for preventive services. Durable medical equipment is covered at no charge, but preauthorization is required for items over $500. For full details, visit UnitedHealthcare Oxford Member Services.`;
const HKNOWLEDGE = `Horizon blue covers various medical services with different cost-sharing structures. Physician visits for injury/illness require a $20 copayment in-network and 30% coinsurance out-of-network. Diagnostic tests like X-rays and blood work are free in-network but have 30% coinsurance out-of-network. Imaging (CT/PET/MRIs) is also free in-network with the same out-of-network coinsurance. Generic drugs have a $10 copay for a 30-day supply and $20 for a 90-day supply, requiring prior authorization. Outpatient surgery has a $150 copay in-network and 30% coinsurance out-of-network, with prior review for spine-related procedures. Emergency room care has a $100 copay per visit, regardless of network status, with no deductible. Pregnancy and childbirth professional services have a $20 copay in-network and 30% coinsurance out-of-network, with no cost-sharing for preventive services. Durable medical equipment requires 50% coinsurance both in and out of network, with a 50% penalty for non-compliance. For full details, visit Horizon Blue Member Services.
`;

// Plan configuration
interface PlanConfig {
    indexName: string;
    displayName: string;
    description: string;
}

const PLAN_CONFIGS: { [key: string]: PlanConfig } = {
    'horizonblue': {
        indexName: 'horizonblue',
        displayName: 'Horizon Blue Cross Blue Shield',
        description: 'Comprehensive healthcare coverage by Horizon Blue Cross Blue Shield'
    }
};

// Initialize Pinecone client
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY});

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * Get plan configuration by name, defaults to Horizon Blue
 */
function getPlanConfig(planName?: string): PlanConfig {
    if (!planName) return PLAN_CONFIGS[DEFAULT_INDEX];
    const normalizedPlanName = planName.toLowerCase().replace(/\s+/g, '');
    return PLAN_CONFIGS[normalizedPlanName] || PLAN_CONFIGS[DEFAULT_INDEX];
}

/**
 * Generates embeddings for the input text using OpenAI's text-embedding-3-small
 * and truncates the vector to 1024 dimensions.
 */
async function generateEmbeddings(text: string): Promise<number[]> {
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text
        });

        return response.data[0].embedding.slice(0, 1024);
    } catch (error) {
        console.error('Error generating embeddings:', error);
        return Array(DIMENSION).fill(0);
    }
}

/**
 * Retrieves the best-matching context for a query
 */
async function retrieveSingleBestContext(queryEmbedding: number[], index: any): Promise<string> {
    try {
        console.log('Querying Pinecone index:', index.name);
        const results = await index.query({
            vector: queryEmbedding,
            topK: 7,
            includeMetadata: true
        });

        if (results.matches.length === 0) return "";

        // Selecting the best match based on confidence score
        results.matches.sort((a: any, b: any) => b.score - a.score);
        return results.matches[0].metadata.text;
    } catch (error) {
        console.error('Error retrieving context:', error);
        // Check if error message contains "not found" instead of using instanceof
        if (error instanceof Error && error.message.includes('not found')) {
            console.error('Pinecone index not found:', index.name);
        } else {
            console.error('Unexpected error:', error);
        }
        return "";
    }
}

/**
 * Generates a response using OpenAI GPT-4o-mini
 */
async function generateResponse(query: string, context: string, planConfig: PlanConfig): Promise<string> {
    try {
        const prompt = `
        You are an expert assistant answering questions about ${planConfig.displayName}. 
        Use ONLY the given context to answer the question concisely.
        IF any context not present, use this too ${HKNOWLEDGE}
        
        Context:
        ${context}
        
        Question: ${query}
        
        Answer:
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are an expert insurance assistant." }, { role: "user", content: prompt }],
            max_tokens: 150,
            temperature: 0.3
        });

        return response.choices[0]?.message?.content || "I'm unable to generate a response at this time.";
    } catch (error) {
        console.error('Error generating response:', error);
        return "An error occurred while generating the response.";
    }
}

/**
 * Main RAG system query function
 */
export async function queryRAGSystem(query: string, planName?: string): Promise<RAGResponse> {
    try {
        if (!query.trim()) {
            throw new Error("Query cannot be empty");
        }

        const planConfig = getPlanConfig(planName);
        const queryEmbedding = await generateEmbeddings(query);
        const index = pinecone.index(planConfig.indexName);
        const context = await retrieveSingleBestContext(queryEmbedding, index);

        if (!context) {
            return {
                type: 'ai_response',
                message: `I don't have specific information about that aspect of ${planConfig.displayName}.`,
                metadata: { confidence: 0, planName: planConfig.displayName }
            };
        }

        const response = await generateResponse(query, context, planConfig);
        return {
            type: 'ai_response',
            message: response,
            metadata: { context, confidence: 1, planName: planConfig.displayName }
        };
    } catch (error) {
        console.error('RAG System Error:', error);
        return {
            type: 'error',
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
            metadata: { confidence: 0 }
        };
    }
}

// Export helper functions for testing
export const _test = {
    generateEmbeddings,
    retrieveSingleBestContext,
    generateResponse,
    getPlanConfig
};
