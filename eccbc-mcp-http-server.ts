#!/usr/bin/env node
// eccbc-mcp-http-server.ts
import express from 'express';
import cors from 'cors';

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

class ECCBCMCPHTTPServer {
    private app: express.Application;

    constructor() {
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());

        // Log des requêtes
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    private setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                service: 'ECCBC MCP Server'
            });
        });

        // Endpoint principal MCP
        this.app.post('/mcp', async (req, res) => {
            try {
                const response = await this.handleMCPRequest(req.body);
                res.json(response);
            } catch (error: any) {
                console.error('Erreur MCP:', error);
                res.status(500).json({
                    error: {
                        code: -32603,
                        message: 'Internal error',
                        data: error.message
                    }
                });
            }
        });

        // Endpoints directs pour les outils (pour tests)
        this.app.post('/tools/search_products', async (req, res) => {
            const result = await this.searchProducts(req.body.search_term, req.body.language);
            res.json(result);
        });

        this.app.post('/tools/check_stock', async (req, res) => {
            const result = await this.checkStock(req.body.product_id, req.body.language);
            res.json(result);
        });

        this.app.post('/tools/create_order', async (req, res) => {
            const result = await this.createOrder(req.body);
            res.json(result);
        });

        this.app.get('/resources', (req, res) => {
            res.json(this.getAvailableResources());
        });
    }

    private async handleMCPRequest(request: any): Promise<any> {
        const { method, params } = request;

        switch (method) {
            case 'resources/list':
                return {
                    resources: [
                        {
                            uri: 'eccbc://catalog',
                            mimeType: 'text/plain',
                            name: 'Catalogue produits ECCBC',
                            description: 'Catalogue complet avec stock temps réel'
                        },
                        {
                            uri: 'eccbc://darija',
                            mimeType: 'text/plain',
                            name: 'Guide expressions Darija',
                            description: 'Expressions darija courantes pour commandes'
                        },
                        {
                            uri: 'eccbc://context',
                            mimeType: 'text/plain',
                            name: 'Contexte business ECCBC',
                            description: 'Informations contextuelles entreprise'
                        }
                    ]
                };

            case 'resources/read':
                return await this.readResource(params.uri);

            case 'tools/list':
                return {
                    tools: [
                        {
                            name: 'search_products',
                            description: 'Rechercher des produits par nom',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    search_term: { type: 'string' },
                                    language: { type: 'string', default: 'fr' }
                                },
                                required: ['search_term']
                            }
                        },
                        {
                            name: 'check_stock',
                            description: 'Vérifier stock d\'un produit',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    product_id: { type: 'integer' },
                                    language: { type: 'string', default: 'fr' }
                                },
                                required: ['product_id']
                            }
                        },
                        {
                            name: 'create_order',
                            description: 'Créer une commande',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    customer_phone: { type: 'string' },
                                    items: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                product_id: { type: 'integer' },
                                                quantity: { type: 'integer' }
                                            }
                                        }
                                    }
                                },
                                required: ['customer_phone', 'items']
                            }
                        }
                    ]
                };

            case 'tools/call':
                return await this.callTool(params.name, params.arguments);

            default:
                throw new Error(`Méthode non supportée: ${method}`);
        }
    }

    private async callTool(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'search_products':
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(await this.searchProducts(args.search_term, args.language), null, 2)
                    }]
                };

            case 'check_stock':
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(await this.checkStock(args.product_id, args.language), null, 2)
                    }]
                };

            case 'create_order':
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(await this.createOrder(args), null, 2)
                    }]
                };

            default:
                throw new Error(`Outil inconnu: ${toolName}`);
        }
    }

    private async readResource(uri: string): Promise<any> {
        switch (uri) {
            case 'eccbc://catalog':
                return {
                    contents: [{
                        uri,
                        mimeType: 'text/plain',
                        text: await this.getCatalogResource()
                    }]
                };
            case 'eccbc://darija':
                return {
                    contents: [{
                        uri,
                        mimeType: 'text/plain',
                        text: this.getDarijaResource()
                    }]
                };
            case 'eccbc://context':
                return {
                    contents: [{
                        uri,
                        mimeType: 'text/plain',
                        text: this.getContextResource()
                    }]
                };
            default:
                throw new Error(`Ressource inconnue: ${uri}`);
        }
    }

    // Méthodes API (identiques à ton serveur original)
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

    // Ressources statiques (identiques)
    private async getCatalogResource(): Promise<string> {
        // ... (code identique à ton serveur original)
        return "Catalogue ECCBC - Version HTTP";
    }

    private getDarijaResource(): string {
        return `=== GUIDE DARIJA ECCBC ===

PRODUITS PRINCIPAUX:
• كوكا / كوكا كولا = Coca-Cola  
• فانتا = Fanta
• سبرايت = Sprite

QUANTITÉS:
• واحد=1, جوج=2, تلاتة=3
• صندوق = caisse
• دزينة = douzaine

EXPRESSIONS:
• بغيت = Je veux
• عطيني = Donne-moi  
• شحال = Combien`;
    }

    private getContextResource(): string {
        return `=== CONTEXTE ECCBC ===

MISSION:
- Distributeur officiel Coca-Cola Maroc B2B
- Support multilingue (Français/Arabe/Anglais)
- Livraison 24-48h`;
    }

    private getAvailableResources() {
        return {
            resources: ['catalog', 'darija', 'context'],
            tools: ['search_products', 'check_stock', 'create_order'],
            api_base: API_BASE_URL
        };
    }

    public start(port: number = 3001) {
        this.app.listen(port, () => {
            console.log(`🚀 ECCBC MCP HTTP Server démarré sur le port ${port}`);
            console.log(`📍 Endpoint MCP : http://localhost:${port}/mcp`);
            console.log(`🏥 Health check : http://localhost:${port}/health`);
        });
    }
}

// Démarrage du serveur
const server = new ECCBCMCPHTTPServer();
server.start(3001);