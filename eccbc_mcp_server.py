# Fichier: eccbc_mcp_server.py
# Serveur MCP compatible Claude Desktop

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
import httpx
from mcp.server.models import InitializationOptions
from mcp.server import NotificationOptions, Server
from mcp.types import Resource, Tool, TextContent, ImageContent, EmbeddedResource
from mcp.server.stdio import stdio_server
from pydantic import AnyUrl

# Configuration logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("eccbc-mcp")

# Configuration
API_BASE_URL = "http://n8n.xandys.xyz:8000"


class ECCBCMCPServer:
    def __init__(self):
        self.server = Server("eccbc-stock-management")
        self.http_client = httpx.AsyncClient()
        self.setup_handlers()

    def setup_handlers(self):
        """Configuration des handlers MCP"""

        @self.server.list_resources()
        async def handle_list_resources() -> list[Resource]:
            """Lister les ressources disponibles"""
            return [
                Resource(
                    uri=AnyUrl("eccbc://catalog"),
                    name="Catalogue produits ECCBC",
                    description="Catalogue complet des produits avec stock en temps réel",
                    mimeType="text/plain",
                ),
                Resource(
                    uri=AnyUrl("eccbc://darija"),
                    name="Guide expressions Darija",
                    description="Expressions darija courantes pour commandes boissons",
                    mimeType="text/plain",
                ),
                Resource(
                    uri=AnyUrl("eccbc://context"),
                    name="Contexte business ECCBC",
                    description="Informations contextuelles sur l'entreprise et processus",
                    mimeType="text/plain",
                ),
            ]

        @self.server.read_resource()
        async def handle_read_resource(uri: AnyUrl) -> str:
            """Lire le contenu d'une ressource"""

            if str(uri) == "eccbc://catalog":
                return await self._get_catalog_resource()
            elif str(uri) == "eccbc://darija":
                return await self._get_darija_resource()
            elif str(uri) == "eccbc://context":
                return await self._get_context_resource()
            else:
                raise ValueError(f"Ressource inconnue: {uri}")

        @self.server.list_tools()
        async def handle_list_tools() -> list[Tool]:
            """Lister les tools disponibles"""
            return [
                Tool(
                    name="search_products",
                    description="Rechercher des produits par nom en français, arabe ou anglais",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "search_term": {
                                "type": "string",
                                "description": "Terme de recherche (coca, فانتا, sprite, etc.)"
                            },
                            "language": {
                                "type": "string",
                                "description": "Langue de recherche (fr, ar, en)",
                                "default": "fr"
                            }
                        },
                        "required": ["search_term"]
                    },
                ),
                Tool(
                    name="check_stock",
                    description="Vérifier la disponibilité d'un produit spécifique",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "product_id": {
                                "type": "integer",
                                "description": "ID du produit à vérifier"
                            },
                            "language": {
                                "type": "string",
                                "description": "Langue pour la réponse (fr, ar, en)",
                                "default": "fr"
                            }
                        },
                        "required": ["product_id"]
                    },
                ),
                Tool(
                    name="get_all_products",
                    description="Récupérer tous les produits disponibles avec stock",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "active_only": {
                                "type": "boolean",
                                "description": "Récupérer seulement les produits actifs",
                                "default": True
                            }
                        }
                    },
                ),
                Tool(
                    name="create_order",
                    description="Créer une nouvelle commande pour un client",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "customer_phone": {
                                "type": "string",
                                "description": "Numéro WhatsApp du client"
                            },
                            "items": {
                                "type": "array",
                                "description": "Liste des produits commandés",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "product_id": {"type": "integer"},
                                        "quantity": {"type": "integer"}
                                    },
                                    "required": ["product_id", "quantity"]
                                }
                            },
                            "customer_name": {
                                "type": "string",
                                "description": "Nom optionnel du client"
                            },
                            "language": {
                                "type": "string",
                                "description": "Langue de communication",
                                "default": "fr"
                            },
                            "notes": {
                                "type": "string",
                                "description": "Notes supplémentaires"
                            }
                        },
                        "required": ["customer_phone", "items"]
                    },
                ),
                Tool(
                    name="get_customer_history",
                    description="Récupérer l'historique des commandes d'un client",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "customer_phone": {
                                "type": "string",
                                "description": "Numéro du client"
                            },
                            "limit": {
                                "type": "integer",
                                "description": "Nombre max de commandes",
                                "default": 10
                            }
                        },
                        "required": ["customer_phone"]
                    },
                ),
            ]

        @self.server.call_tool()
        async def handle_call_tool(name: str, arguments: dict) -> list[TextContent]:
            """Exécuter un tool"""

            try:
                if name == "search_products":
                    result = await self._search_products(
                        arguments.get("search_term"),
                        arguments.get("language", "fr")
                    )
                elif name == "check_stock":
                    result = await self._check_stock(
                        arguments.get("product_id"),
                        arguments.get("language", "fr")
                    )
                elif name == "get_all_products":
                    result = await self._get_all_products(
                        arguments.get("active_only", True)
                    )
                elif name == "create_order":
                    result = await self._create_order(arguments)
                elif name == "get_customer_history":
                    result = await self._get_customer_history(
                        arguments.get("customer_phone"),
                        arguments.get("limit", 10)
                    )
                else:
                    raise ValueError(f"Tool inconnu: {name}")

                return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]

            except Exception as e:
                logger.error(f"Erreur dans {name}: {e}")
                return [TextContent(type="text", text=json.dumps({"error": str(e)}, ensure_ascii=False))]

    # Méthodes API
    async def _search_products(self, search_term: str, language: str = "fr") -> Dict[str, Any]:
        """Rechercher des produits"""
        try:
            response = await self.http_client.get(
                f"{API_BASE_URL}/api/products/search/{search_term}",
                params={"language": language}
            )
            response.raise_for_status()
            products = response.json()

            return {
                "success": True,
                "products": products,
                "count": len(products) if isinstance(products, list) else 0,
                "search_term": search_term,
                "language": language
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _check_stock(self, product_id: int, language: str = "fr") -> Dict[str, Any]:
        """Vérifier le stock d'un produit"""
        try:
            response = await self.http_client.get(
                f"{API_BASE_URL}/api/stock/check/{product_id}",
                params={"language": language}
            )
            response.raise_for_status()
            return {"success": True, "stock": response.json()}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_all_products(self, active_only: bool = True) -> Dict[str, Any]:
        """Récupérer tous les produits"""
        try:
            response = await self.http_client.get(
                f"{API_BASE_URL}/api/products",
                params={"active_only": active_only}
            )
            response.raise_for_status()
            products = response.json()

            return {
                "success": True,
                "products": products,
                "count": len(products)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _create_order(self, arguments: dict) -> Dict[str, Any]:
        """Créer une commande"""
        try:
            response = await self.http_client.post(
                f"{API_BASE_URL}/api/orders",
                json=arguments
            )
            response.raise_for_status()
            return {"success": True, "order": response.json()}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_customer_history(self, customer_phone: str, limit: int = 10) -> Dict[str, Any]:
        """Historique client"""
        try:
            response = await self.http_client.get(
                f"{API_BASE_URL}/api/orders/{customer_phone}",
                params={"limit": limit}
            )
            response.raise_for_status()
            return {"success": True, "orders": response.json()}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # Ressources statiques
    async def _get_catalog_resource(self) -> str:
        """Catalogue produits pour contexte"""
        try:
            result = await self._get_all_products()
            if not result["success"]:
                return "Erreur: Impossible de récupérer le catalogue"

            catalog = "=== CATALOGUE ECCBC ===\n\n"
            for product in result["products"]:
                catalog += f"• {product.get('name', 'N/A')} (Code: {product.get('code', 'N/A')})\n"
                if product.get('name_ar'):
                    catalog += f"  العربية: {product['name_ar']}\n"
                catalog += f"  Prix: {product.get('price', 0)} MAD\n"
                catalog += f"  Stock: {product.get('available_quantity', 0)} {product.get('unit_type', 'unités')}\n"
                catalog += f"  Format: {product.get('unit_size', 'Standard')}\n\n"

            return catalog
        except Exception as e:
            return f"Erreur catalogue: {e}"

    async def _get_darija_resource(self) -> str:
        """Guide expressions darija"""
        return """=== GUIDE DARIJA ECCBC ===

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
• شوية = Un peu
"""

    async def _get_context_resource(self) -> str:
        """Contexte business"""
        return """=== CONTEXTE ECCBC ===

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

TONE: Professionnel, chaleureux, respecter langue client
"""

    async def run(self):
        """Démarrer le serveur MCP"""
        from mcp.server.stdio import stdio_server

        async with self.http_client:
            async with stdio_server() as (read_stream, write_stream):
                await self.server.run(
                    read_stream,
                    write_stream,
                    InitializationOptions(
                        server_name="eccbc-stock-management",
                        server_version="1.0.0",
                        capabilities=self.server.get_capabilities(
                            notification_options=NotificationOptions(),
                            experimental_capabilities={}
                        )
                    )
                )


# Point d'entrée
async def main():
    server = ECCBCMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())