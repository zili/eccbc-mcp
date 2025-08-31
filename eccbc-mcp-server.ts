#!/usr/bin/env node
// eccbc-mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Configuration
const API_BASE_URL = 'http://n8n.xandys.xyz:8000';

interface OrderItem {
    product_id: number;
    quantity: number;
}

interface CreateOrderRequest {
    customer_phone: string;
    items: OrderItem[];
    customer_name?: string;
    language?: string;
    notes?: string;
}

class ECCBCMCPServer {
    private server: Server;

    constructor() {
        this.server = new Server(
            {
                name: 'eccbc-stock-management',
                version: '1.0.0',
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            }
        );

        this.setupHandlers();
    }

    private setupHandlers() {
        // Handler pour lister les ressources
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return {
                resources: [
                    {
                        uri: 'eccbc://catalog',
                        mimeType: 'text/plain',
                        name: 'Catalogue produits ECCBC',
                        description: 'Catalogue complet avec stock temps réel',
                    },
                    {
                        uri: 'eccbc://darija',
                        mimeType: 'text/plain',
                        name: 'Guide expressions Darija',
                        description: 'Expressions darija courantes pour commandes',
                    },
                    {
                        uri: 'eccbc://context',
                        mimeType: 'text/plain',
                        name: 'Contexte business ECCBC',
                        description: 'Informations contextuelles entreprise',
                    },
                ],
            };
        });

        // Handler pour lire une ressource
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params.uri;

            switch (uri) {
                case 'eccbc://catalog':
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: 'text/plain',
                                text: await this.getCatalogResource(),
                            },
                        ],
                    };
                case 'eccbc://darija':
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: 'text/plain',
                                text: this.getDarijaResource(),
                            },
                        ],
                    };
                case 'eccbc://context':
                    return {
                        contents: [
                            {
                                uri,
                                mimeType: 'text/plain',
                                text: this.getContextResource(),
                            },
                        ],
                    };
                default:
                    throw new McpError(ErrorCode.InvalidRequest, `Ressource inconnue: ${uri}`);
            }
        });

        // Handler pour lister les tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'search_products',
                        description: 'Rechercher des produits par nom en français, arabe ou anglais',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                search_term: {
                                    type: 'string',
                                    description: 'Terme de recherche (coca, فانتا, sprite, etc.)',
                                },
                                language: {
                                    type: 'string',
                                    description: 'Langue de recherche (fr, ar, en)',
                                    default: 'fr',
                                },
                            },
                            required: ['search_term'],
                        },
                    },
                    {
                        name: 'check_stock',
                        description: 'Vérifier la disponibilité d\'un produit spécifique',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                product_id: {
                                    type: 'integer',
                                    description: 'ID du produit à vérifier',
                                },
                                language: {
                                    type: 'string',
                                    description: 'Langue pour la réponse (fr, ar, en)',
                                    default: 'fr',
                                },
                            },
                            required: ['product_id'],
                        },
                    },
                    {
                        name: 'get_all_products',
                        description: 'Récupérer tous les produits disponibles avec stock',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                active_only: {
                                    type: 'boolean',
                                    description: 'Récupérer seulement les produits actifs',
                                    default: true,
                                },
                            },
                        },
                    },
                    {
                        name: 'create_order',
                        description: 'Créer une nouvelle commande pour un client',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                customer_phone: {
                                    type: 'string',
                                    description: 'Numéro WhatsApp du client',
                                },
                                items: {
                                    type: 'array',
                                    description: 'Liste des produits commandés',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            product_id: { type: 'integer' },
                                            quantity: { type: 'integer' },
                                        },
                                        required: ['product_id', 'quantity'],
                                    },
                                },
                                customer_name: {
                                    type: 'string',
                                    description: 'Nom optionnel du client',
                                },
                                language: {
                                    type: 'string',
                                    description: 'Langue de communication',
                                    default: 'fr',
                                },
                                notes: {
                                    type: 'string',
                                    description: 'Notes supplémentaires',
                                },
                            },
                            required: ['customer_phone', 'items'],
                        },
                    },
                    {
                        name: 'get_customer_history',
                        description: 'Récupérer l\'historique des commandes d\'un client',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                customer_phone: {
                                    type: 'string',
                                    description: 'Numéro du client',
                                },
                                limit: {
                                    type: 'integer',
                                    description: 'Nombre max de commandes',
                                    default: 10,
                                },
                            },
                            required: ['customer_phone'],
                        },
                    },
                ],
            };
        });

        // Handler pour exécuter les tools
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            // Type assertion pour args
            const toolArgs = args as Record<string, any>;

            try {
                let result: any;
                switch (name) {
                    case 'search_products':
                        result = await this.searchProducts(toolArgs.search_term as string, (toolArgs.language as string) || 'fr');
                        break;
                    case 'check_stock':
                        result = await this.checkStock(toolArgs.product_id as number, (toolArgs.language as string) || 'fr');
                        break;
                    case 'get_all_products':
                        result = await this.getAllProducts(toolArgs.active_only !== false);
                        break;
                    case 'create_order':
                        result = await this.createOrder(toolArgs as CreateOrderRequest);
                        break;
                    case 'get_customer_history':
                        result = await this.getCustomerHistory(toolArgs.customer_phone as string, (toolArgs.limit as number) || 10);
                        break;
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Tool inconnu: ${name}`);
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error: any) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ success: false, error: error.message }, null, 2),
                        },
                    ],
                };
            }
        });
    }

    // Méthodes API
    private async searchProducts(searchTerm: string, language: string = 'fr'): Promise<any> {
        try {
            const url = `${API_BASE_URL}/api/products/search/${encodeURIComponent(searchTerm)}?language=${language}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const products = await response.json();
            return {
                success: true,
                products,
                count: Array.isArray(products) ? products.length : 0,
                search_term: searchTerm,
                language,
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                search_term: searchTerm,
            };
        }
    }

    private async checkStock(productId: number, language: string = 'fr'): Promise<any> {
        try {
            const url = `${API_BASE_URL}/api/stock/check/${productId}?language=${language}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const stock = await response.json();
            return {
                success: true,
                stock,
                is_available: stock.available,
                quantity_available: stock.quantity,
                product_name: stock.product_name,
                product_name_local: stock.product_name_local,
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                product_id: productId,
            };
        }
    }

    private async getAllProducts(activeOnly: boolean = true): Promise<any> {
        try {
            const url = `${API_BASE_URL}/api/products?active_only=${activeOnly}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const products = await response.json();
            return {
                success: true,
                products,
                count: products.length,
                active_only: activeOnly,
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
            };
        }
    }

    private async createOrder(orderData: CreateOrderRequest): Promise<any> {
        try {
            const response = await fetch(`${API_BASE_URL}/api/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(orderData),
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const order = await response.json();
            return {
                success: true,
                order,
                order_id: order.order_id,
                order_number: order.order_number,
                total_amount: order.total_amount,
                status: order.status || 'pending',
                message: order.message || 'Commande créée avec succès',
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                customer_phone: orderData.customer_phone,
            };
        }
    }

    private async getCustomerHistory(customerPhone: string, limit: number = 10): Promise<any> {
        try {
            const url = `${API_BASE_URL}/api/orders/${encodeURIComponent(customerPhone)}?limit=${limit}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const orders = await response.json();
            return {
                success: true,
                orders,
                customer_phone: customerPhone,
                order_count: Array.isArray(orders) ? orders.length : 0,
                limit,
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                customer_phone: customerPhone,
            };
        }
    }

    // Ressources statiques
    private async getCatalogResource(): Promise<string> {
        try {
            const result = await this.getAllProducts();
            if (!result.success) {
                return 'Erreur: Impossible de récupérer le catalogue';
            }

            let catalog = '=== CATALOGUE ECCBC ===\n\n';
            for (const product of result.products) {
                catalog += `• ${product.name || 'N/A'} (Code: ${product.code || 'N/A'})\n`;
                if (product.name_ar) {
                    catalog += `  العربية: ${product.name_ar}\n`;
                }
                catalog += `  Prix: ${product.price || 0} MAD\n`;
                catalog += `  Stock: ${product.available_quantity || 0} ${product.unit_type || 'unités'}\n`;
                catalog += `  Format: ${product.unit_size || 'Standard'}\n\n`;
            }

            return catalog;
        } catch (error) {
            return `Erreur catalogue : ${error}`;
        }
    }

    private getDarijaResource(): string {
        return `=== GUIDE DARIJA ECCBC ===

PRODUITS:
• كوكا / كوكا كولا = Coca-Cola  
• فانتا = Fanta
• سبرايت = Sprite
• الحمرا = La rouge (Coca-Cola)
• الصفرا = La jaune (Fanta citron)
• البرتقالية = L'orange (Fanta orange)

QUANTITÉS:
• واحد=1, جوج=2, تلاتة=3, ربعة=4, خمسة=5
• ستة=6, سبعة=7, تمنية=8, تسعة=9, عشرة=10
• صندوق/صناديق = caisse(s)

EXPRESSIONS:
• بغيت = Je veux
• عطيني = Donne-moi  
• شحال = Combien
• كاين = Disponible
• واش كاين = Est-ce qu'il y a
• بزاف = Beaucoup
• شوية = Un peu`;
    }

    private getContextResource(): string {
        return `=== CONTEXTE ECCBC ===

MISSION: B2B embouteilleur Coca-Cola Maroc
- Vente aux commerçants via WhatsApp
- Support multilingue (FR/AR/EN)
- Livraison 24-48h partout au Maroc

PROCESSUS:
1. Client exprime besoin librement
2. Clarification si nécessaire  
3. Vérification stock temps réel
4. Confirmation prix/délai
5. Création commande automatique

UNITÉS: Caisses de 6/12/24, Prix en MAD
FORMATS: 33cl, 50cl, 1L, 1.5L

TONE: Professionnel, chaleureux, respecter langue client`;
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Serveur MCP ECCBC TypeScript démarré');
    }
}

// Point d'entrée
async function main() {
    const server = new ECCBCMCPServer();
    await server.run();
}

// Démarrage du serveur
main().catch(console.error);